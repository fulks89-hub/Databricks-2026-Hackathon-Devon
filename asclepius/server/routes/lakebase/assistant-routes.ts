/**
 * Asclepius — Multi-persona, cited, agentic AI assistant.
 *
 * POST /api/assistant — a single server-grounded endpoint. The SERVER owns the
 * whole grounding pipeline so no ungrounded prose can reach the client:
 *
 *   1. RETRIEVE  — SQL keyword fallback over the REAL Lakebase `app_read.facilities`
 *                  (no Vector Search; the index is still building). AI_GROUNDING §2.3.
 *   2. GROUND+FM — build a persona system prompt + the retrieved facilities as the
 *                  ONLY allowed evidence, then call the Foundation Model
 *                  (databricks-meta-llama-3-3-70b-instruct) at temperature 0 with
 *                  strict JSON `response_format` and 429/5xx backoff. AI_GROUNDING §5.2.
 *   3. CITE GUARD — re-derive every citation's quote as a LITERAL substring of the
 *                  named field of the retrieved facility (the model's quote is a
 *                  HYPOTHESIS, never trusted). AI_GROUNDING §3.3.
 *   4. UNCERTAINTY — score in [0,100] from lexical retrieval strength + trust tier
 *                  minus an always-on throttle penalty (keyword fallback). §4.
 *   5. ACTIONS   — validate each suggested action; its payload MUST target a
 *                  facility_id from the retrieved set (the model can't invent one).
 *                  The CLIENT executes only on explicit user confirm.
 *
 * FM transport (per the validated probe): do NOT use appkit.serving().invoke() —
 * that plugin's request-body allowlist silently STRIPS `response_format`, breaking
 * strict JSON. Instead call the serving endpoint directly through AppKit's own
 * WorkspaceClient (`getWorkspaceClient({}).apiClient.request(...)`), which uses the
 * app service-principal auth automatically and preserves `response_format`, returning
 * clean bare JSON.
 */
import { getWorkspaceClient } from '@databricks/appkit';
import type express from 'express';
import { callerEmail } from './persistence-routes.js';
import type { AppkitLike, LakebaseClient } from './persistence-routes.js';

// ---------------------------------------------------------------------------
// The wire contract (mirrors client/src/lib/api.ts AssistantResponse).
// ---------------------------------------------------------------------------

type Persona = 'patient' | 'clinician' | 'hospital';
type ActionType = 'shortlist' | 'refer' | 'post_opening';
type Band = 'high' | 'medium' | 'low';

interface AssistantScope {
  state?: string;
  district?: string;
  specialty?: string;
}

interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface Citation {
  facility_id: string;
  facility_name: string;
  field: string;
  quote: string;
}

interface Uncertainty {
  score: number;
  band: Band;
  caveats: string[];
}

interface SuggestedAction {
  type: ActionType;
  label: string;
  payload: Record<string, unknown>;
}

interface AssistantResponse {
  answer: string;
  citations: Citation[];
  uncertainty: Uncertainty;
  suggestedActions: SuggestedAction[];
}

// ---------------------------------------------------------------------------
// Small HTTP helpers (mirror read-routes.ts / persistence-routes.ts).
// ---------------------------------------------------------------------------

function ok(res: express.Response, body: unknown, status = 200): void {
  res.status(status).json(body);
}
function fail(res: express.Response, code: string, message: string, status = 400): void {
  res.status(status).json({ error: { code, message } });
}

function h(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[asclepius:assistant] route error:', message);
      if (!res.headersSent) fail(res, 'INTERNAL', message, 500);
    });
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// ---------------------------------------------------------------------------
// Request parsing (defensive; the body is untrusted JSON).
// ---------------------------------------------------------------------------

const PERSONAS: readonly Persona[] = ['patient', 'clinician', 'hospital'];

interface AssistantRequest {
  persona: Persona;
  message: string;
  scope: AssistantScope;
  history: HistoryTurn[];
}

function parseRequest(raw: unknown): AssistantRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const personaRaw = str(body.persona);
  const persona: Persona = PERSONAS.includes(personaRaw as Persona)
    ? (personaRaw as Persona)
    : 'patient';

  const message = str(body.message).trim();
  if (!message) return null;

  const scopeRaw =
    typeof body.scope === 'object' && body.scope !== null
      ? (body.scope as Record<string, unknown>)
      : {};
  const scope: AssistantScope = {
    state: str(scopeRaw.state).trim() || undefined,
    district: str(scopeRaw.district).trim() || undefined,
    specialty: str(scopeRaw.specialty).trim() || undefined,
  };

  const history: HistoryTurn[] = [];
  if (Array.isArray(body.history)) {
    for (const t of body.history) {
      if (typeof t !== 'object' || t === null) continue;
      const turn = t as Record<string, unknown>;
      const role = str(turn.role);
      const content = str(turn.content).trim();
      if ((role === 'user' || role === 'assistant') && content) {
        history.push({ role, content });
      }
    }
  }
  // Keep the prompt compact: only the last 6 turns reach the model.
  return { persona, message, scope, history: history.slice(-6) };
}

// ---------------------------------------------------------------------------
// 1. RETRIEVE — SQL keyword fallback over app_read.facilities (AI_GROUNDING §2.3).
// ---------------------------------------------------------------------------

/** Citeable free-text fields, in the order we expose them to the model. */
const CITE_FIELDS = ['description', 'capability', 'procedure', 'equipment'] as const;
type CiteField = (typeof CITE_FIELDS)[number];

interface FacilityRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  specialties: unknown;
  trust: string | null;
  conf: number | null;
  description: string | null;
  capability: string | null;
  procedure: string | null;
  equipment: string | null;
}

/** A retrieved candidate, decorated with its lexical match strength. */
interface Candidate extends FacilityRow {
  matched: number; // # distinct query terms matched (the SQL `score`)
}

const STOPWORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'by', 'can', 'do', 'find',
  'for', 'from', 'good', 'has', 'have', 'help', 'here', 'how', 'i', 'in', 'is',
  'it', 'looking', 'me', 'my', 'near', 'need', 'of', 'on', 'or', 'please',
  'show', 'that', 'the', 'there', 'to', 'want', 'what', 'where', 'which', 'who',
  'will', 'with', 'you', 'your',
]);

/** Tokenize a message into distinct lowercase content terms (>=3 chars). */
function tokenize(message: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of message.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const term = m[0];
    if (term.length < 3 || STOPWORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= 8) break; // cap term count -> bounded SQL
  }
  return out;
}

const TERM_FIELDS = [
  'f.name',
  'f.city',
  "COALESCE(f.description,'')",
  "COALESCE(f.capability,'')",
  "COALESCE(f.procedure,'')",
  "COALESCE(f.equipment,'')",
] as const;

/**
 * Retrieve up to `limit` facilities by tokenized keyword match. State filtering
 * MUST join app_read.facility_district on fd.unique_id=f.id and filter
 * fd.nfhs_state (facilities.state is DIRTY); when no state scope is present we
 * OMIT the join so the ~1,059 unmapped facilities remain retrievable.
 */
async function retrieve(
  db: LakebaseClient,
  terms: string[],
  scope: AssistantScope,
  limit = 10,
): Promise<Candidate[]> {
  if (terms.length === 0) return [];

  const params: unknown[] = [];
  const termIdx: number[] = []; // $-index of each term's LIKE param
  for (const t of terms) {
    params.push(`%${t}%`);
    termIdx.push(params.length);
  }

  // score = # distinct terms matched anywhere across the searchable fields.
  const scoreExpr = termIdx
    .map((i) => {
      const ors = TERM_FIELDS.map((f) => `${f} ILIKE $${i}`).join(' OR ');
      return `(CASE WHEN (${ors}) THEN 1 ELSE 0 END)`;
    })
    .join(' + ');

  // WHERE: at least one term matches at least one field.
  const anyTermMatch = termIdx
    .map((i) => TERM_FIELDS.map((f) => `${f} ILIKE $${i}`).join(' OR '))
    .join(' OR ');

  const hasState = !!scope.state;
  const hasSpecialty = !!scope.specialty;
  const stateIdx = hasState ? (params.push(scope.state), params.length) : 0;
  const specIdx = hasSpecialty ? (params.push(scope.specialty), params.length) : 0;

  const joinClause = hasState
    ? 'JOIN app_read.facility_district fd ON fd.unique_id = f.id'
    : '';
  const stateClause = hasState ? `AND fd.nfhs_state = $${stateIdx}` : '';
  const specClause = hasSpecialty ? `AND f.specialties ? $${specIdx}` : '';

  const sql = `
    SELECT f.id, f.name, f.city, f.state, f.specialties, f.trust, f.conf,
           f.description, f.capability, f.procedure, f.equipment,
           (${scoreExpr}) AS score
    FROM app_read.facilities f
    ${joinClause}
    WHERE (${anyTermMatch})
      ${stateClause}
      ${specClause}
    ORDER BY score DESC, (f.trust = 'verified') DESC, f.conf DESC NULLS LAST
    LIMIT ${limit}`;

  const r = await db.query<FacilityRow & { score: number | string | null }>(sql, params);
  return r.rows.map((row) => {
    const { score, ...rest } = row;
    return { ...rest, matched: Number(score) || 0 };
  });
}

/** Field text by name, or '' if absent. */
function fieldText(row: FacilityRow, field: string): string {
  if ((CITE_FIELDS as readonly string[]).includes(field)) {
    const v = row[field as CiteField];
    return typeof v === 'string' ? v : '';
  }
  return '';
}

/** Render specialties (JSONB array) as a short comma list for the prompt. */
function specialtiesList(v: unknown): string {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string').join(', ');
  }
  return '';
}

// ---------------------------------------------------------------------------
// 2. GROUND + FM CALL — persona prompt + retrieved evidence, strict JSON, temp 0.
// ---------------------------------------------------------------------------

const PERSONA_BRIEF: Record<Persona, string> = {
  patient:
    'You help a PATIENT or family find the right care. You NEVER diagnose, ' +
    'never prescribe, and never imply urgency beyond what a source states. You ' +
    'point to facilities that match the need and explain what each offers.',
  clinician:
    'You advise a CLINICIAN about where their discipline is needed and which ' +
    'facilities they could refer to or collaborate with. Be precise and clinical.',
  hospital:
    'You advise a HOSPITAL administrator on coverage gaps and recruiting — which ' +
    'facilities exist nearby, what they cover, and where openings make sense.',
};

/** Compact evidence block: one entry per retrieved facility, only citeable fields. */
function buildEvidence(cands: Candidate[]): string {
  const blocks = cands.map((c, idx) => {
    const lines: string[] = [
      `[#${idx + 1}] facility_id: ${c.id}`,
      `name: ${c.name}`,
      `city: ${str(c.city) || 'unknown'}`,
    ];
    const specs = specialtiesList(c.specialties);
    if (specs) lines.push(`specialties: ${specs}`);
    for (const field of CITE_FIELDS) {
      const t = fieldText(c, field).trim();
      if (t) lines.push(`${field}: ${t}`);
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

function systemPrompt(persona: Persona, scope: AssistantScope): string {
  const scopeBits: string[] = [];
  if (scope.state) scopeBits.push(`state=${scope.state}`);
  if (scope.district) scopeBits.push(`district=${scope.district}`);
  if (scope.specialty) scopeBits.push(`specialty=${scope.specialty}`);
  const scopeLine = scopeBits.length ? `Current scope: ${scopeBits.join(', ')}.` : '';

  return [
    `You are Asclepius, a grounded health-facility assistant. ${PERSONA_BRIEF[persona]}`,
    scopeLine,
    'You may ONLY use the EVIDENCE facilities provided below. Do not use outside',
    'knowledge and do not invent facilities, facility_ids, fields, or quotes.',
    '',
    'For every factual statement you make about a facility, attach a citation whose',
    'quote is copied VERBATIM (character-for-character) from that facility\'s named',
    'field in the EVIDENCE. Cite only the fields description, capability, procedure,',
    'or equipment. Each quote must be at least 8 characters and appear exactly in the',
    'source text. If the evidence does not support an answer, say so plainly and',
    'return no citations rather than guessing.',
    '',
    'You may also suggest up to 3 confirmable actions the user can take, each',
    'targeting one of the EVIDENCE facilities by its facility_id:',
    persona === 'hospital'
      ? '- "post_opening": draft a recruiting opening near a facility.'
      : '',
    persona === 'clinician'
      ? '- "refer": draft a referral to a facility.'
      : '',
    '- "shortlist": save a facility for the user to revisit.',
    'Only suggest an action that references a facility_id present in the EVIDENCE.',
    '',
    // NOTE: the FM serving endpoint's json_object guardrail requires the literal
    // lowercase word "json" somewhere in the messages — keep it in this line.
    'Respond with a single json object and nothing else — your entire reply MUST be valid json — in exactly this shape:',
    '{"answer": string,',
    ' "citations": [{"facility_id": string, "field": string, "quote": string}],',
    ' "suggestedActions": [{"type": "shortlist"|"refer"|"post_opening", "label": string, "facility_id": string}]}',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

interface FmCitation {
  facility_id?: unknown;
  field?: unknown;
  quote?: unknown;
}
interface FmAction {
  type?: unknown;
  label?: unknown;
  facility_id?: unknown;
}
interface FmOutput {
  answer?: unknown;
  citations?: unknown;
  suggestedActions?: unknown;
}

/** OpenAI chat-completions response shape (we only read the text content). */
interface FmChat {
  choices?: { message?: { content?: string } }[];
}

const FM_ENDPOINT =
  process.env.DATABRICKS_SERVING_ENDPOINT_NAME ?? 'databricks-meta-llama-3-3-70b-instruct';

function readStatus(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.status === 'number') return obj.status;
  if (typeof obj.statusCode === 'number') return obj.statusCode;
  const resp = obj.response;
  if (typeof resp === 'object' && resp !== null) {
    const rs = (resp as Record<string, unknown>).status;
    if (typeof rs === 'number') return rs;
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Foundation Model serving endpoint via AppKit's WorkspaceClient (SP
 * auth, no manual token). Preserves response_format (json_object), returns the
 * raw `choices[0].message.content` string. Retries on 429/5xx with capped
 * exponential backoff + jitter (AI_GROUNDING §5.2).
 */
async function callFm(messages: { role: string; content: string }[]): Promise<string> {
  const wc = getWorkspaceClient({});
  const payload = {
    messages,
    temperature: 0,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  };

  const maxAttempts = 5;
  let delay = 500;
  for (let attempt = 0; ; attempt++) {
    try {
      const raw: unknown = await wc.apiClient.request({
        path: `/serving-endpoints/${encodeURIComponent(FM_ENDPOINT)}/invocations`,
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        raw: false,
        payload,
      });
      const chat = raw as FmChat;
      const content = chat.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Foundation Model returned no text content');
      }
      return content;
    } catch (e: unknown) {
      const status = readStatus(e);
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt >= maxAttempts) throw e;
      const wait = delay + Math.random() * 250;
      await sleep(wait);
      delay = Math.min(delay * 2, 8000);
    }
  }
}

/** Strip a markdown ```json fence if one slipped in, then JSON.parse. */
function parseFmJson(content: string): FmOutput | null {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) return parsed as FmOutput;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. CITATION GUARD — re-derive each quote as a literal substring (§3.3).
// ---------------------------------------------------------------------------

/** Map an index in the whitespace-normalized string back to the raw string. */
function mapNormIndexToRaw(raw: string, normIndex: number): number {
  let seen = 0;
  let prevWasSpace = false;
  // Normalization = collapse runs of whitespace to one space + trim. Walk the
  // raw string, counting the chars that survive normalization until we reach
  // normIndex, then return the raw offset.
  let i = 0;
  // Skip leading whitespace (trim).
  while (i < raw.length && /\s/.test(raw[i])) i++;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (prevWasSpace) continue; // collapsed run
      if (seen === normIndex) return i;
      seen++;
      prevWasSpace = true;
    } else {
      if (seen === normIndex) return i;
      seen++;
      prevWasSpace = false;
    }
  }
  return seen === normIndex ? i : -1;
}

/**
 * Verify the model's quote against the named field of the cited facility and
 * return a citation whose quote is the REAL substring sliced from the source
 * (never the model's text). Returns null if it does not anchor.
 */
function anchorCitation(model: FmCitation, byId: Map<string, Candidate>): Citation | null {
  const facilityId = str(model.facility_id);
  const field = str(model.field);
  const needle = str(model.quote);
  if (!facilityId || !field || needle.length < 8) return null;
  if (!(CITE_FIELDS as readonly string[]).includes(field)) return null;

  const cand = byId.get(facilityId);
  if (!cand) return null;
  const hay = fieldText(cand, field);
  if (hay.length < 8) return null;

  // (a) exact literal substring — the strict path.
  let rel = hay.indexOf(needle);
  let len = needle.length;

  // (b) tolerant: whitespace-normalized re-anchor, mapped back to raw offsets.
  if (rel < 0) {
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const hn = norm(hay);
    const nn = norm(needle);
    if (nn.length < 8) return null;
    const ni = hn.indexOf(nn);
    if (ni < 0) return null;
    const startRaw = mapNormIndexToRaw(hay, ni);
    const endRaw = mapNormIndexToRaw(hay, ni + nn.length);
    if (startRaw < 0 || endRaw < 0 || endRaw <= startRaw) return null;
    rel = startRaw;
    len = endRaw - startRaw;
  }

  return {
    facility_id: facilityId,
    facility_name: cand.name,
    field,
    quote: hay.slice(rel, rel + len), // the REAL bytes from the source
  };
}

// ---------------------------------------------------------------------------
// 4. UNCERTAINTY — lexical strength + trust tier minus always-on throttle (§4).
// ---------------------------------------------------------------------------

const THROTTLE_PENALTY = 0.12; // always on: keyword fallback (no Vector Search)
const THROTTLE_CAVEAT = 'Retrieval is keyword-based — vector index still building.';

function trustMult(trust: string | null): number {
  if (trust === 'verified') return 1.0;
  if (trust === 'review') return 0.9;
  return 0.75; // unverified / unknown
}

/**
 * Message-level uncertainty. With no Vector Search we approximate `sim` from the
 * lexical retrieval strength of the cited facilities (fraction of query terms
 * each matched), gate by the weakest cited facility's trust tier, and always
 * subtract the throttle penalty. No anchored citations -> score 0, band low.
 */
function computeUncertainty(
  anchored: Citation[],
  byId: Map<string, Candidate>,
  termCount: number,
): Uncertainty {
  if (anchored.length === 0) {
    return { score: 0, band: 'low', caveats: [THROTTLE_CAVEAT] };
  }

  const cited = anchored
    .map((c) => byId.get(c.facility_id))
    .filter((c): c is Candidate => c !== undefined);

  // sim: average fraction of query terms matched across cited facilities.
  const denom = Math.max(1, termCount);
  const sims = cited.map((c) => clamp01(c.matched / denom));
  const sim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;

  // llm proxy: anchoring is a hard pass, so support strength is high once a quote
  // is byte-verified; coverage grows with the number of distinct cited facilities.
  const llm = 0.85;
  const cov = clamp01(cited.length / 3);

  // trust gate = the WEAKEST cited facility's tier (a message is only as strong
  // as its least-trusted evidence).
  const gate = Math.min(...cited.map((c) => trustMult(c.trust)));

  const raw =
    100 * (0.45 * sim + 0.35 * llm + 0.2 * cov) * gate - 100 * THROTTLE_PENALTY;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const band: Band = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

  const caveats: string[] = [THROTTLE_CAVEAT];
  const weakest = cited.reduce<Candidate | null>(
    (acc, c) => (acc === null || trustMult(c.trust) < trustMult(acc.trust) ? c : acc),
    null,
  );
  if (weakest && weakest.trust !== 'verified') {
    caveats.push(`Lowest-trust cited facility: ${weakest.trust ?? 'unverified'}.`);
  }

  return { score, band, caveats };
}

// ---------------------------------------------------------------------------
// 5. ACTIONS — validate type + facility_id-in-retrieved-set, build a payload the
//    client can hand straight to saveShortlist / createReferral / createPosting.
// ---------------------------------------------------------------------------

const ACTION_TYPES: readonly ActionType[] = ['shortlist', 'refer', 'post_opening'];

/** Which action types each persona is allowed to surface. */
const ALLOWED_ACTIONS: Record<Persona, readonly ActionType[]> = {
  patient: ['shortlist'],
  clinician: ['shortlist', 'refer'],
  hospital: ['shortlist', 'post_opening'],
};

function buildActionPayload(
  type: ActionType,
  cand: Candidate,
): Record<string, unknown> {
  switch (type) {
    case 'shortlist':
      return { facility_id: cand.id };
    case 'refer':
      return {
        facility_id: cand.id,
        facility_name: cand.name,
        city: str(cand.city) || undefined,
        state: str(cand.state) || undefined,
      };
    case 'post_opening':
      return {
        // createPosting requires city + discipline; carry sensible defaults
        // derived ONLY from the retrieved facility (no invented data).
        facility_id: cand.id,
        city: str(cand.city),
        discipline: specialtiesList(cand.specialties).split(', ')[0] ?? '',
        hospital: cand.name,
      };
  }
}

function validateActions(
  rawActions: unknown,
  persona: Persona,
  byId: Map<string, Candidate>,
): SuggestedAction[] {
  if (!Array.isArray(rawActions)) return [];
  const allowed = ALLOWED_ACTIONS[persona];
  const out: SuggestedAction[] = [];
  const seen = new Set<string>();

  for (const a of rawActions) {
    if (typeof a !== 'object' || a === null) continue;
    const action = a as FmAction;
    const type = str(action.type);
    if (!ACTION_TYPES.includes(type as ActionType)) continue;
    const t = type as ActionType;
    if (!allowed.includes(t)) continue;

    const facilityId = str(action.facility_id);
    const cand = byId.get(facilityId);
    if (!cand) continue; // the model may not invent a target

    const dedupeKey = `${t}:${facilityId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const label = str(action.label).trim() || defaultLabel(t, cand);
    out.push({ type: t, label, payload: buildActionPayload(t, cand) });
    if (out.length >= 3) break;
  }
  return out;
}

function defaultLabel(type: ActionType, cand: Candidate): string {
  switch (type) {
    case 'shortlist':
      return `Save ${cand.name}`;
    case 'refer':
      return `Refer to ${cand.name}`;
    case 'post_opening':
      return `Post an opening near ${cand.name}`;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

function registerAssistantRoutes(app: express.Application, db: LakebaseClient): void {
  // POST /api/assistant — the full grounded pipeline.
  app.post(
    '/api/assistant',
    h(async (req, res) => {
      // Identity is captured for parity with the write routes (audit / future
      // per-user grounding); the assistant itself is owner-agnostic for now.
      void callerEmail(req);

      const parsed = parseRequest(req.body);
      if (!parsed) {
        return fail(res, 'BAD_REQUEST', 'persona + non-empty message required');
      }
      const { persona, message, scope, history } = parsed;

      // 1. RETRIEVE
      const terms = tokenize(message);
      let cands: Candidate[] = [];
      try {
        cands = await retrieve(db, terms, scope);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.error('[asclepius:assistant] retrieval failed:', m);
      }

      const byId = new Map<string, Candidate>(cands.map((c) => [c.id, c]));

      // No evidence at all -> honest INSUFFICIENT_EVIDENCE (no FM call).
      if (cands.length === 0) {
        const body: AssistantResponse = {
          answer:
            'I could not find any facilities in the registry matching that request. ' +
            'Try naming a city, specialty, or condition.',
          citations: [],
          uncertainty: { score: 0, band: 'low', caveats: [THROTTLE_CAVEAT] },
          suggestedActions: [],
        };
        return ok(res, body);
      }

      // 2. GROUND + FM CALL
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt(persona, scope) },
        ...history.map((t) => ({ role: t.role, content: t.content })),
        {
          // NB: the FM json_object guardrail only counts the literal word "json"
          // in a USER message — the system prompt's "json" is ignored — so the
          // explicit "json" instruction MUST live on this last user turn.
          role: 'user',
          content: `${message}\n\nEVIDENCE (the only facilities you may use):\n${buildEvidence(
            cands,
          )}\n\nReturn ONLY the json object specified above — no prose, no markdown.`,
        },
      ];

      let fmContent: string;
      try {
        fmContent = await callFm(messages);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.error('[asclepius:assistant] FM call failed:', m);
        return fail(res, 'FM_UNAVAILABLE', 'The assistant is temporarily unavailable.', 503);
      }

      const fm = parseFmJson(fmContent);
      if (!fm || typeof fm.answer !== 'string') {
        const body: AssistantResponse = {
          answer: 'INSUFFICIENT_EVIDENCE: I could not produce a grounded answer.',
          citations: [],
          uncertainty: { score: 0, band: 'low', caveats: [THROTTLE_CAVEAT] },
          suggestedActions: [],
        };
        return ok(res, body);
      }

      // 3. CITATION GUARD — keep only quotes that literally anchor.
      const anchored: Citation[] = [];
      const anchoredKeys = new Set<string>();
      if (Array.isArray(fm.citations)) {
        for (const c of fm.citations) {
          if (typeof c !== 'object' || c === null) continue;
          const cite = anchorCitation(c as FmCitation, byId);
          if (!cite) continue;
          const key = `${cite.facility_id}:${cite.field}:${cite.quote}`;
          if (anchoredKeys.has(key)) continue;
          anchoredKeys.add(key);
          anchored.push(cite);
        }
      }

      // If the model claimed facts but NOTHING anchored, downgrade the prose to
      // an explicit insufficient-evidence note (no ungrounded claims surface).
      const claimedCitations =
        Array.isArray(fm.citations) && fm.citations.length > 0;
      let answer = fm.answer.trim();
      if (claimedCitations && anchored.length === 0) {
        answer =
          'INSUFFICIENT_EVIDENCE: I could not verify any of that against the ' +
          'registry text, so I am not stating it as fact.';
      }

      // 4. UNCERTAINTY
      const uncertainty = computeUncertainty(anchored, byId, terms.length);

      // 5. ACTIONS
      const suggestedActions = validateActions(fm.suggestedActions, persona, byId);

      const body: AssistantResponse = {
        answer,
        citations: anchored,
        uncertainty,
        suggestedActions,
      };
      ok(res, body);
    }),
  );
}

// ---------------------------------------------------------------------------
// Entry point — called from onPluginsReady (alongside setupReadRoutes).
// ---------------------------------------------------------------------------

/** Mounts POST /api/assistant. Async-shaped to mirror the other setup helpers. */
export function setupAssistantRoutes(appkit: AppkitLike): Promise<void> {
  appkit.server.extend((app) => {
    registerAssistantRoutes(app, appkit.lakebase);
  });
  return Promise.resolve();
}
