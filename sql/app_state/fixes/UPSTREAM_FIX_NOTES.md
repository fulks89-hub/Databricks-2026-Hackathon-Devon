# Upstream district-scoring fixes — review notes for Peter

**Status: DRAFTED READ-ONLY. NOT EXECUTED ON LIVE. Review before running.**
Every query in these files was validated with `SELECT`/CTE only against
`workspace.virtue_foundation_clean_v3` and `workspace.app_state` (profile `team`) on
2026-06-16. Nothing was `CREATE`/`REPLACE`/`MERGE`/`DELETE`-d. The `.sql` files ship the
DDL **commented out** so you choose the target and run them yourself.

Files in this folder:
- `gold_district_supply_need_FIX.sql` — the corrected gold build (the substantive fix).
- `district_demand_FIX.sql` — confirms demand needs no rebuild; optional `is_proxy` flag.
- `UPSTREAM_FIX_NOTES.md` — this note.

---

## 1. Your audit is right. Credit where due.

We re-probed the live data independently and **every checkable claim in your audit
reproduced exactly.** In particular the headline finding is correct and important:

- **1,059 unmapped / 9,018 mapped facilities** (of 10,077). All 1,059 unmapped carry
  `match_status='unmapped'` and `NULL nfhs_district` — they never reach any district.
- **`facility_count` is a stale snapshot**: gold sum = **9,183**, live recount = **9,018**
  mapped (overcounts by ~165). And it's not just magnitude drift — **membership flips**:
  18 districts the snapshot says HAVE facilities have 0 mapped live; 11 it calls zero-fac
  have mapped facilities live.
- **The 87.0 pin**: all zero-facility districts are pinned to `supply_scarcity = 87.0`,
  the **global max**, which sits ABOVE the entire non-zero band (tops out at 66.8 at
  `facility_count=1`). Confirmed against live gold.
- **Supply dominates desert**: corr(desert, supply) = **0.878** vs corr(desert, need) =
  **0.656**; **128** of the worst-quartile deserts and **all 10** of the worst 10 were
  zero-facility 87.0 pins (Araria/Lakhisarai/Banka/Arwal/Jamui Bihar; Pakur/Pashchimi
  Singhbhum/Sahibganj Jharkhand; Panna MP).

Bottom line you nailed: **the join gap was being scored as real medical scarcity.**

---

## 2. The one nuance the probe resolved: demand is NOT supply-coupled.

You measured corr(demand, desert) and first saw 0.297, then 0.564. The **0.564 is the
correct, per-district figure** (the 0.297 came from a 9× fan-out in the *measurement* join,
not from the data). But here is the resolution that matters for the fix:

**The live `app_read.district_demand` is byte-for-byte identical to the repo NFHS-need-only
"RIGOROUS REBUILD". It has NO supply term.** (6,354 rows = 706×9; columns
`nfhs_district, state, discipline, demand_score, top_driver`; sample values identical live
vs repo; the 3 proxy disciplines are 100% `(proxy)`-prefixed = 33.3% of rows.)

So the 0.564 correlation is **not leaked supply**. It is:
1. **genuine need/supply co-location** — high-need Bihar/Jharkhand districts really are
   supply-poor; plus
2. **inflation from the broken desert_score itself** — the 87.0 zero-fac pin shoved
   high-need zero-fac districts to the top of desert, and those same districts have high
   demand *because they have high need*.

**Therefore: fixing `desert_score` (un-pinning the join-gap zeros) is what shrinks the
spurious part of that correlation. `district_demand` needs no decoupling and no rebuild.**

---

## 3. What `gold_district_supply_need_FIX.sql` changes, and why

Four labelled fixes; the column **contract is preserved** and the new columns are additive.

| Fix | Change | Why |
|-----|--------|-----|
| **FIX-1** | `facility_count` = LIVE recount of **mapped** facilities from `app_state.facility_district` (excludes the 1,059 unmapped). | Replaces the stale 9,183 snapshot with the live 9,018 mapped truth; fixes the membership drift. |
| **FIX-2** | New `has_facilities`, `supply_known` (booleans) and `coverage_flag` (`'mapped'` \| `'insufficient_supply_data'`). | Makes "0 mapped facilities" an **honest unknown**, not a data point. |
| **FIX-3** | `supply_scarcity` ranked over the **517 mapped districts only**; `desert_score` (**need-led 0.35·supply + 0.65·need**) and `desert_rank` computed over mapped only. Unknown-supply districts get **NULL** scarcity/desert/rank and are excluded from the worst-desert leaderboard. | Kills the 87.0 global-max pin AND the supply-domination bias. Join-gap zeros no longer outrank real scarcity; desert now tracks **need** (corr 0.826) over **supply** (corr 0.797). |
| **FIX-4** | `need_score` recomputed as the explicit equal-weighted percentile of the 7 NFHS indicators with direction applied. | Same signal as today (validated **corr 1.0, mean abs err 0.069**), now auditable and decoupled from the supply defect. NFHS need is real and kept. |

**Reverse-engineered formulas we relied on (so you can check our work):**
- The LEGACY `desert_score = 0.5*supply_scarcity + 0.5*need_score` — fit to live gold at
  **corr 1.0000**, mean abs err 0.024. The FIX does **NOT** keep 50/50 — see the weighting
  decision below.
- **Weighting decision (important — this changed during validation).** A naive 50/50
  blend over the corrected mapped subset still leaves desert **supply-led**
  (corr 0.908 supply vs 0.687 need) because `supply_scarcity` has ~1.73x the spread of
  `need_score` (stddev 32.2 vs 18.6 among the 517 mapped), and a fixed-weight sum is
  dominated by the higher-variance term. We swept weights live; the supply/need
  correlation crossover is ~0.365/0.635. The FIX therefore uses the clean need-led weight
  **`desert_score = 0.35*supply_scarcity + 0.65*need_score`**, validated to put need in the
  lead with margin: **corr(desert,need)=0.826 > corr(desert,supply)=0.797**. (Alternative
  for your consideration: z-scoring both terms before a 50/50 blend gives an exact
  0.812/0.812 tie — a *balanced* rather than *need-led* desert.)
- `need_score` = equal-weighted mean of the 7 NFHS indicators' percent-ranks, direction
  applied (coverage indicators `institutional_birth`, `mothers_4anc`, `sanitation`,
  `health_insurance` inverted `100 - pr*100`; burden indicators `child_stunted`,
  `child_underweight`, `anaemia_w15_49` direct) — our recompute matched gold at **corr
  1.0, mean abs err 0.069**.
- We **did NOT** reproduce the legacy `supply_scarcity` closed form. It is a monotone rank
  of `facility_count` (corr 0.999 to `100*(1 - percent_rank(facility_count))` but mean abs
  err ~5.5 — we couldn't pin the exact curve: fac 0→87.0, 1→66.8, 2→54.3, 3→46.0, 4→40.1,
  5→35.6 … 324→0.0). **We don't need to** — the fix *replaces the mechanism* by ranking
  scarcity over mapped-only districts.

**Validation of the corrected build (live, SELECT-only):**
- 706 in → 706 out (grain preserved). 517 mapped, 189 `insufficient_supply_data`.
- Mapped supply_scarcity spans a clean 0.0–100.0 (no 87.0 phantom); desert_score 8.6–95.1;
  desert_rank dense 1..N.
- **Bias fixed:** corr(desert,need)=**0.826** > corr(desert,supply)=**0.797** (was
  0.656/0.878 supply-led in legacy).
- New worst deserts are genuine: **Madhepura / Kishanganj / Kaimur / Supaul / Buxar**
  (Bihar), each with **1 mapped facility** AND need_score 84–92. Araria (old #1) is now
  correctly `insufficient_supply_data` (0 mapped facilities) with NULL desert_rank.

### Column-contract guarantees (read this before adopting)
- **No existing column is renamed or removed.** All 13 contract columns stay, in order.
- **Added (nullable, additive):** `has_facilities` (bool), `supply_known` (bool),
  `coverage_flag` (string).
- **Behavioural change the app MUST handle:** `supply_scarcity`, `desert_score`,
  `desert_rank` are now **NULL** for the 189 unknown-supply districts (previously a
  non-NULL 87.0 phantom). **Confirm the app sorts NULL desert_score/rank LAST** (not
  first) and uses `coverage_flag`/`supply_known` to badge "insufficient supply data"
  before you adopt this. This is the single integration risk. The app/client code was not
  touched per scope — this is a heads-up for whoever owns it.
- **Deployment target is your call** (both written into the file, DDL commented out):
  - **Option A (recommended):** materialize a new `…clean_v4.gold_district_supply_need`,
    diff v3 vs v4, then repoint the `app_state` passthrough view. Instant rollback.
  - **Option B:** `CREATE OR REPLACE` v3 in place — only after the app's NULL handling is
    confirmed.

---

## 4. `district_demand_FIX.sql` — no rebuild

As established in §2, demand is already the correct supply-free NFHS build. The file:
- **Option 1 (recommended):** do nothing — the `(proxy) ` prefix on `top_driver` already
  marks the 3 proxy disciplines; the app can badge with `top_driver LIKE '(proxy)%'`.
- **Option 2 (optional):** add an explicit boolean `is_proxy` column (additive; preserves
  all existing columns). Cleanest if adopted by appending the `is_proxy` expression to the
  final `SELECT` in the existing `district_demand.sql` build, **not** as a self-referential
  wrapper (the file explains the gotcha).

The proxy disciplines (Orthopedics, Ophthalmology, Trauma) are 100% tobacco/alcohol proxy
because NFHS-5 has no MSK/injury/eye measures — 33.3% of demand rows. Badging them is the
honest move; recomputing them is not possible without new source data.

---

## 5. Separate follow-ups (NOT defects these FIX files address)

1. **No population denominator.** Every score is rank-normalized, never per-capita. The
   FIX already removes the *supply-domination* bias via the need-led 0.35/0.65 weight
   (corr 0.826 need vs 0.797 supply over the 517 mapped). What it does **not** do is make
   scarcity a per-capita rate — a 1-facility district of 3M people and one of 300k score
   the same. The durable improvement is to normalise scarcity by district population once
   a population denominator is available. **Note the weight is a design lever:** 0.35/0.65
   is the validated need-led choice; z-scoring both terms before 50/50 gives a balanced
   0.812/0.812; pick per your policy.

2. **True-zero vs join-gap is indistinguishable at district grain.** The 1,059 unmapped
   facilities carry NULL `nfhs_district`, so every zero-mapped district is "supply
   unknown", not provably "true zero". The FIX flags all 189 as
   `insufficient_supply_data` rather than pretending to separate them. **The real upstream
   win is recovering the 1,059** by fixing the pincode → `district_crosswalk` join (257 of
   them have non-castable `address_zipOrPostcode`; the rest miss the pincode table or the
   crosswalk). That's the highest-leverage upstream task after this fix lands.

3. **Homonym phantom — Chandel/Mizoram.** Verified: `Chandel` appears under **both**
   Manipur and Mizoram with **byte-identical** values (desert 65.2, need 43.3, fc 0).
   Mizoram has no Chandel district — it's Manipur's Chandel copied. **Interim fix:** drop
   the `(Chandel, Mizoram)` key (allow-list of one). **Durable fix:** canonical
   `(state, district)` crosswalk upstream in v3.
   - **Keep the other 7 split names** — Aurangabad (Bihar+Maharashtra), Bilaspur (HP+CG),
     Hamirpur (UP+HP), Pratapgarh (UP+Rajasthan), Balrampur, Bijapur, Raigarh are
     **genuine distinct real districts** and must stay separate `(state,district)` keys.

4. **State-spelling drift drops 5 states** from `state_coverage` ↔ gold joins. Canonical
   fix = an alias map: `&` ↔ `And`, `'Maharastra'`→`'Maharashtra'`, `'NCT of Delhi'` ↔
   `'Delhi'`, strip leading `'The'`, collapse Dadra/Daman variants.
   **Caveat:** Ladakh and Lakshadweep are in gold but NOT in `state_coverage` because they
   genuinely have **0 facilities** — a real coverage gap, not a spelling mismatch. An alias
   map will not (and should not) recover them.

---

## 6. Operational notes

- All probes were **READ-ONLY**; nothing on live was modified.
- The Lakebase OAuth token expires ~hourly (regenerated per query via
  `databricks postgres generate-database-credential`); the FIX files operate on Unity
  Catalog v3/app_state via profile `team`, not Lakebase, so token expiry doesn't block you.
- **Review the SELECT output, decide the deployment target, confirm the app's NULL-desert
  handling, THEN run.** These files were drafted read-only and not executed on live.

---

## 7. Independent validation run — before/after (live, READ-ONLY, 2026-06-16, profile `team`)

The corrected build was re-validated by wrapping the entire FIX logic as a `SELECT`/CTE
against live `workspace.virtue_foundation_clean_v3` + `workspace.app_state` (no DDL run).
This run also **caught and fixed a defect in the first draft**: the original 0.5/0.5
desert weight did *not* reverse the supply bias. The weight was changed to **0.35/0.65**
(need-led) and re-validated. All numbers below are from the live run.

### Headline criterion — desert bias (FIX-3)
| desert_score definition (mapped subset, n=517) | corr(desert, **supply**) | corr(desert, **need**) | leans |
|---|---|---|---|
| **Legacy v3** (50/50, all 706, 87.0 pin) | **0.878** | **0.656** | supply ❌ |
| First draft (corrected mapped-only, but 50/50) | 0.908 | 0.687 | supply ❌ |
| **Shipped FIX (0.35/0.65, need-led)** | **0.797** | **0.826** | **need ✅** |

Why 50/50 failed even after the mapped-only fix: among the 517 mapped districts
`supply_scarcity` has stddev **32.2** vs `need_score` **18.6** (~1.73x), so a fixed-weight
sum is dominated by supply. Weight sweep (live): 0.4/0.6 → 0.841/0.781 (still supply-led);
0.35/0.65 → 0.797/0.826 (need-led, shipped); 0.30/0.70 → 0.746/0.869; z-scored 50/50 →
0.812/0.812 (tie).

### `insufficient_supply_data` count + leaderboard exclusion (FIX-2/3)
- **189** districts flagged `insufficient_supply_data` (0 mapped facilities), all with NULL
  `supply_scarcity`/`desert_score`/`desert_rank`. 517 flagged `mapped`.
- **They no longer occupy the worst ranks.** The new desert top-10 are all `mapped`
  genuine high-need low-supply districts: Madhepura, Kishanganj, Kaimur (Bhabua), Supaul,
  Buxar (Bihar; 1 fac, need 84.7–92.5); Katihar, Nawada, Saran (Bihar; 2 fac, need
  88.6–94.0); Bahraich (UP); Dumka (Jharkhand). The legacy zero-fac top pins —
  **Araria, Lakhisarai, Banka** (Bihar), **Pakur** (Jharkhand), **Panna** (MP) — are now
  all `insufficient_supply_data` with NULL `desert_rank` (verified directly).

### facility_count vs live recount (FIX-1)
- Build `facility_count` = independent live recount for **706/706** districts (**0
  mismatches**); both sum to **9,018** mapped.
- vs stale legacy snapshot: **123** districts differ; stale sum **9,183** vs live **9,018**
  (over by 165). Membership flips reproduced exactly: **18** snapshot-has-facilities →
  0 mapped live; **11** snapshot-zero → mapped live.

### need_score fidelity (FIX-4)
- Recomputed 7-indicator need_score vs legacy gold: **corr 0.99996**, **mean abs err
  0.069** — same signal, now explicit/auditable and decoupled from supply.

### Column contract (criterion 4)
- All **13** original columns present in order (`nfhs_district, state`, 7 NFHS cols,
  `facility_count, need_score, supply_scarcity, desert_score, desert_rank`) + **3** new
  additive nullable flags (`has_facilities, supply_known, coverage_flag`). 706 in → 706 out.

### demand (district_demand_FIX)
- Confirmed live `app_state.district_demand` = 6,354 rows = 706×9, no supply column.
  `is_proxy` candidate flag splits **2,118** proxy (3 disciplines) / **4,236** non-proxy
  (6 disciplines) = 33.3% proxy. No rebuild needed; optional `is_proxy` flag validated.

**Conclusion: all four acceptance criteria pass after the 0.35/0.65 weight correction.**
The one behavioural change for the app stands: `supply_scarcity`/`desert_score`/
`desert_rank` are NULL for the 189 unknown-supply districts — the app must sort NULLs LAST
and badge via `coverage_flag`. Still drafted READ-ONLY; DDL commented out; not run on live.
