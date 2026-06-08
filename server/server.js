/* JDM Finder API server.
   - GET  /api/health   → status + counts + last refresh
   - GET  /api/catalog  → models + countries (frontend dropdowns)
   - GET  /api/listings → filtered/sorted listings (live from Neon, else sample)
   - POST /api/refresh  → trigger an Apify scrape (protected by REFRESH_SECRET)
   Designed for the GitHub Pages frontend to call cross-origin (CORS open for reads). */

import express from "express";
import cors from "cors";
import cron from "node-cron";

import { MODELS, COUNTRIES, MODEL_BY_KEY, matchesModel } from "./catalog.js";
import { initSchema, hasDb, countLive, queryLive, getMeta, setMeta, getAllLive, deleteListingsByIds, divideLivePrices } from "./db.js";
import { SAMPLE } from "./sample.js";
import { isConfigured, runRefresh } from "./scraper.js";

const PORT = process.env.PORT || 3000;
const REFRESH_SECRET = (process.env.REFRESH_SECRET || "").trim();
const REFRESH_CRON = (process.env.REFRESH_CRON || "0 */6 * * *").trim(); // every 6h
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*").trim();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: CORS_ORIGINS === "*" ? true : CORS_ORIGINS.split(",").map((s) => s.trim()),
  })
);

// ---- in-memory sample filtering (fallback when there's no live data yet) ----
function applySampleFilters(items, f) {
  let out = items.slice();
  if (f.model && f.model !== "all") out = out.filter((x) => x.model === f.model);
  if (f.country && f.country !== "all") out = out.filter((x) => x.country === f.country);
  if (f.query) { const q = f.query.toLowerCase(); out = out.filter((x) => (x.title + " " + x.modelName + " " + x.city).toLowerCase().includes(q)); }
  if (f.minPrice) out = out.filter((x) => x.price >= +f.minPrice);
  if (f.maxPrice) out = out.filter((x) => x.price <= +f.maxPrice);
  switch (f.sort) {
    case "price_asc": out.sort((a, b) => a.price - b.price); break;
    case "price_desc": out.sort((a, b) => b.price - a.price); break;
    default: out.sort((a, b) => a.postedDaysAgo - b.postedDaysAgo);
  }
  return out;
}

// ---- routes ----
app.get("/api/health", async (_req, res) => {
  let live = 0;
  let lastRefresh = null;
  try { live = await countLive(); lastRefresh = await getMeta("last_refresh"); } catch (e) { /* db may be down */ }
  res.json({
    ok: true,
    db: hasDb(),
    apify: isConfigured(),
    liveListings: live,
    sampleListings: SAMPLE.length,
    mode: live > 0 ? "live" : "sample",
    lastRefresh,
  });
});

app.get("/api/catalog", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  // `match` is server-side scrape config; don't leak it to the frontend.
  const models = MODELS.map(({ match, ...m }) => m);
  res.json({ models, countries: COUNTRIES });
});

app.get("/api/listings", async (req, res) => {
  const f = {
    model: req.query.model || "all",
    country: req.query.country || "all",
    minPrice: req.query.minPrice || "",
    maxPrice: req.query.maxPrice || "",
    query: (req.query.q || req.query.query || "").trim(),
    sort: req.query.sort || "newest",
    limit: req.query.limit,
  };
  try {
    const live = await countLive();
    if (live > 0) {
      const items = await queryLive(f);
      const lastRefresh = await getMeta("last_refresh");
      return res.json({ items, count: items.length, live: true, lastRefresh });
    }
  } catch (e) {
    console.error("[listings] db error, serving sample:", e.message);
  }
  const items = applySampleFilters(SAMPLE, f);
  res.json({ items, count: items.length, live: false, lastRefresh: null });
});

// ---- refresh (protected) ----
let refreshing = false;
function authorized(req) {
  if (!REFRESH_SECRET) return false; // must be configured to allow triggering
  const got = req.get("x-refresh-secret") || req.query.secret || "";
  return got === REFRESH_SECRET;
}
async function handleRefresh(req, res) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized (bad or missing secret)" });
  if (!isConfigured()) return res.status(400).json({ ok: false, error: "Apify not configured (APIFY_TOKEN / APIFY_ACTOR)." });
  if (refreshing) return res.status(409).json({ ok: false, error: "a refresh is already running" });
  refreshing = true;
  try {
    // ?reset=1 wipes existing live rows before repopulating (purges old junk).
    const reset = req.query.reset === "1" || req.query.reset === "true";
    const summary = await runRefresh({ reset });
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    refreshing = false;
  }
}
app.post("/api/refresh", handleRefresh);
app.get("/api/refresh", handleRefresh); // convenience for cron-job.org / browser

/* One-time, in-place repair of already-stored rows (no Apify scrape needed):
   - divides prices by 100 once (fixes the cents→dollars inflation), guarded by
     a meta flag so a later correct scrape isn't halved;
   - deletes rows that no longer pass the per-model relevance/parts filter.
   Protected by REFRESH_SECRET. Safe to call repeatedly. */
async function handleCleanup(req, res) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized (bad or missing secret)" });
  if (!hasDb()) return res.status(400).json({ ok: false, error: "no database configured" });
  try {
    let priceFixed = 0;
    if (!(await getMeta("cents_fix_applied"))) {
      priceFixed = await divideLivePrices(100);
      await setMeta("cents_fix_applied", new Date().toISOString());
    }
    const rows = await getAllLive();
    const badIds = rows
      .filter((r) => { const m = MODEL_BY_KEY[r.model]; return !m || !matchesModel(r.title, r.description, m); })
      .map((r) => r.id);
    const deleted = await deleteListingsByIds(badIds);
    res.json({ ok: true, priceFixed, scanned: rows.length, deleted, remaining: rows.length - deleted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.post("/api/cleanup", handleCleanup);
app.get("/api/cleanup", handleCleanup);

app.get("/", (_req, res) =>
  res.type("text").send("JDM Finder API. Try /api/health, /api/catalog, /api/listings")
);

// ---- boot ----
async function boot() {
  if (hasDb()) {
    try { await initSchema(); console.log("[db] schema ready"); }
    catch (e) { console.error("[db] schema init failed:", e.message); }
  }

  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

  // Populate on first boot (background, non-blocking) if we have a source + DB but no live data.
  if (isConfigured() && hasDb()) {
    try {
      const live = await countLive();
      if (live === 0) {
        console.log("[scrape] no live data yet — kicking off initial refresh in the background");
        refreshing = true;
        runRefresh().catch((e) => console.error("[scrape] initial refresh failed:", e.message)).finally(() => { refreshing = false; });
      }
    } catch (e) { /* ignore */ }

    // Scheduled refresh
    if (cron.validate(REFRESH_CRON)) {
      cron.schedule(REFRESH_CRON, () => {
        if (refreshing) return;
        refreshing = true;
        console.log("[scrape] scheduled refresh");
        runRefresh().catch((e) => console.error("[scrape] scheduled refresh failed:", e.message)).finally(() => { refreshing = false; });
      });
      console.log(`[scrape] scheduled with cron "${REFRESH_CRON}"`);
    } else {
      console.warn(`[scrape] invalid REFRESH_CRON "${REFRESH_CRON}" — scheduled refresh disabled`);
    }
  } else {
    console.log("[server] serving SAMPLE data (Apify and/or DATABASE_URL not configured)");
  }
}

boot();
