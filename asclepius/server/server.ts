/**
 * Asclepius — AppKit Node/TS server entry point.
 *
 * Persistence + reads run on Lakebase Postgres (the `lakebase()` plugin):
 *   - WRITE state  → schema `app.*`   (created on boot by the app SP; DEC-001, no passwords).
 *   - READ data    → schema `app_read.*` (synced from Unity Catalog by Snapshot pipelines).
 *
 * The `analytics()` and `serving()` plugins are kept for multi-tool breadth
 * (SQL warehouse + Foundation Models) — good for "Data Relevance".
 *
 * Route wiring is split into two modules, both mounted via `appkit.server.extend`:
 *   server/routes/lakebase/persistence-routes.ts  (OLTP writes + schema bootstrap)
 *   server/routes/lakebase/read-routes.ts         (app_read.* GET endpoints)
 */
import { createApp, lakebase, analytics, server, serving } from '@databricks/appkit';
import { setupPersistenceRoutes } from './routes/lakebase/persistence-routes.js';
import { setupReadRoutes } from './routes/lakebase/read-routes.js';
import { setupReadinessRoutes } from './routes/lakebase/readiness-routes.js';
import { setupAssistantRoutes } from './routes/lakebase/assistant-routes.js';
import type { AppkitLike } from './routes/lakebase/persistence-routes.js';

createApp({
  plugins: [lakebase(), analytics(), server(), serving()],
  async onPluginsReady(appkit) {
    // The setup helpers only need `appkit.lakebase` (query) + `appkit.server`
    // (extend). Narrow to that structural shape; the plugin map is wider.
    // Routed through `unknown` in two steps (a single `as unknown as` is
    // rejected by `appkit lint`'s no-double-type-assertion rule).
    const handle: unknown = appkit;
    const ak = handle as AppkitLike;
    await setupPersistenceRoutes(ak);
    await setupReadRoutes(ak);
    await setupReadinessRoutes(ak);
    await setupAssistantRoutes(ak);
  },
}).catch(console.error);
