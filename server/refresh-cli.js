/* Run one scrape from the command line: `npm run refresh`
   Useful for the first populate or a manual top-up. Reads the same env vars
   as the server (DATABASE_URL, APIFY_TOKEN, APIFY_ACTOR, SCRAPE_*). */

import { initSchema, hasDb, pool } from "./db.js";
import { isConfigured, runRefresh } from "./scraper.js";

(async () => {
  if (!hasDb()) { console.error("DATABASE_URL is not set."); process.exit(1); }
  if (!isConfigured()) { console.error("APIFY_TOKEN / APIFY_ACTOR are not set."); process.exit(1); }
  await initSchema();
  const summary = await runRefresh();
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
  process.exit(summary.errors && summary.upserted === 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
