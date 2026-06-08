/* Apify-backed Facebook Marketplace scraper (server-side).

   Facebook has no public Marketplace API and blocks direct scraping, so this
   drives an Apify "Facebook Marketplace" actor with the OWNER's token (an env
   var on Render). Visitors never see or supply a token. Results are mapped to
   our listing shape and upserted into Neon.

   Actors differ in their input/output keys — `pick()` accepts the common ones.
   If your chosen actor uses different names, extend the arrays in mapItem /
   buildInput. */

import { MODELS, COUNTRIES, MODEL_BY_KEY, COUNTRY_BY_CODE, parseList } from "./catalog.js";
import { upsertListings, setMeta, pruneStale } from "./db.js";

const APIFY_TOKEN = (process.env.APIFY_TOKEN || "").trim();
const APIFY_ACTOR = (process.env.APIFY_ACTOR || "").trim();
const MAX_ITEMS = Number(process.env.SCRAPE_MAX_ITEMS || 40);
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY || 2));
const PRUNE_DAYS = Number(process.env.SCRAPE_PRUNE_DAYS || 14);
const RUN_TIMEOUT = Number(process.env.SCRAPE_RUN_TIMEOUT || 120); // seconds, per actor run

export function isConfigured() {
  return !!(APIFY_TOKEN && APIFY_ACTOR);
}

// Which models/countries to scrape. Models default to ALL; countries default
// to US only (each extra country multiplies Apify credit usage). Override with
// SCRAPE_MODELS / SCRAPE_COUNTRIES (comma-separated keys/codes, or "all").
function targetModels() {
  return parseList(process.env.SCRAPE_MODELS, MODELS.map((m) => m.key), true).map((k) => MODEL_BY_KEY[k]);
}
function targetCountries() {
  const codes = process.env.SCRAPE_COUNTRIES
    ? parseList(process.env.SCRAPE_COUNTRIES, COUNTRIES.map((c) => c.code), false)
    : ["US"];
  return codes.map((c) => COUNTRY_BY_CODE[c]).filter(Boolean);
}

// ---- mapping helpers ----
function pick(o, keys) { for (const k of keys) { if (o && o[k] != null && o[k] !== "") return o[k]; } return undefined; }
function parsePrice(v) {
  if (typeof v === "number") return Math.round(v);
  if (!v) return 0;
  const n = String(v).replace(/[^0-9.]/g, "");
  return n ? Math.round(parseFloat(n)) : 0;
}
function parseNum(v) { const n = parsePrice(v); return n || ""; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function mapImages(it) {
  let imgs = pick(it, ["images", "photos", "imageUrls", "pictures", "photo_urls", "imageUrl"]);
  if (!imgs && it.image) imgs = [it.image];
  if (!Array.isArray(imgs)) imgs = imgs ? [imgs] : [];
  return imgs.map((x) => (typeof x === "string" ? x : pick(x, ["url", "src", "uri", "image"]))).filter(Boolean);
}
function parsePostedAt(it) {
  const raw = pick(it, ["postedAt", "creationTime", "createdAt", "publishedAt", "date", "listedAt"]);
  if (!raw) return null;
  // epoch seconds vs ms vs ISO string
  if (typeof raw === "number") return new Date(raw < 1e12 ? raw * 1000 : raw);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function mapItem(it, model, country, i) {
  const fbId = pick(it, ["id", "listingId", "itemId", "facebookId"]);
  const url = pick(it, ["url", "listingUrl", "link", "permalink"]) || model.query;
  const id = String(fbId || (url && url.length > 8 ? "fb-" + hashStr(url) : `live-${model.key}-${country.code}-${i}`));
  const postedAt = parsePostedAt(it);
  return {
    id,
    model: model.key,
    modelName: model.name,
    query: model.query,
    title: pick(it, ["title", "name", "marketplace_listing_title"]) || (model.name + " listing"),
    price: parsePrice(pick(it, ["price", "priceAmount", "listingPrice", "amount", "formattedPrice"])),
    currency: pick(it, ["currencySymbol"]) || country.cur,
    curCode: pick(it, ["currency", "currencyCode"]) || country.curCode,
    country: country.code,
    countryName: country.name,
    city: pick(it, ["location", "city", "locationText", "place"]) || "",
    year: parseNum(pick(it, ["year"])),
    mileage: parseNum(pick(it, ["mileage", "odometer"])),
    mileageUnit: country.unit,
    transmission: pick(it, ["transmission"]) || "",
    description: pick(it, ["description", "redactedDescription", "text"]) || "",
    images: mapImages(it),
    url,
    seller: pick(it, ["sellerName", "seller"]) || "",
    postedAt: postedAt ? postedAt.toISOString() : null,
    sample: false,
  };
}

function buildInput(model, country) {
  const loc = country.cities[0];
  return {
    query: model.query, search: model.query, keyword: model.query, searchTerm: model.query,
    location: loc, city: loc, country: country.name, countryCode: country.code,
    maxItems: MAX_ITEMS, count: MAX_ITEMS, resultsLimit: MAX_ITEMS, maxResults: MAX_ITEMS,
  };
}

async function runActor(model, country) {
  const url =
    "https://api.apify.com/v2/acts/" + encodeURIComponent(APIFY_ACTOR) +
    "/run-sync-get-dataset-items?token=" + encodeURIComponent(APIFY_TOKEN) +
    "&timeout=" + RUN_TIMEOUT;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildInput(model, country)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("Apify " + res.status + ": " + body.slice(0, 200));
  }
  const items = await res.json();
  return Array.isArray(items) ? items.map((it, i) => mapItem(it, model, country, i)) : [];
}

// simple promise pool so we don't fire 50 actor runs at once
async function pool(tasks, size, worker, onResult) {
  let idx = 0;
  async function next() {
    while (idx < tasks.length) {
      const i = idx++;
      try { onResult(await worker(tasks[i]), tasks[i], null); }
      catch (e) { onResult(null, tasks[i], e); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, next));
}

/* Scrape the whole model × country matrix and upsert into Neon.
   Returns a summary; never throws on a single failed combo. */
export async function runRefresh({ log = console.log } = {}) {
  if (!isConfigured()) throw new Error("Apify not configured — set APIFY_TOKEN and APIFY_ACTOR.");
  const models = targetModels();
  const countries = targetCountries();
  const combos = [];
  for (const m of models) for (const c of countries) combos.push({ m, c });

  log(`[scrape] starting: ${models.length} models × ${countries.length} countries = ${combos.length} runs (concurrency ${CONCURRENCY})`);
  let scraped = 0, inserted = 0;
  const errors = [];
  const all = [];

  await pool(
    combos,
    CONCURRENCY,
    ({ m, c }) => runActor(m, c),
    (items, { m, c }, err) => {
      if (err) { errors.push(`${m.key}/${c.code}: ${err.message}`); log(`[scrape] ✗ ${m.key}/${c.code}: ${err.message}`); return; }
      scraped += items.length;
      all.push(...items);
      log(`[scrape] ✓ ${m.key}/${c.code}: ${items.length} items`);
    }
  );

  // de-dupe across combos by id, then one batched upsert
  const byId = new Map();
  for (const it of all) if (it.images.length || it.url) byId.set(it.id, it);
  const unique = [...byId.values()];
  if (unique.length) {
    const r = await upsertListings(unique);
    inserted = r.inserted;
  }
  const pruned = PRUNE_DAYS > 0 ? await pruneStale(PRUNE_DAYS) : 0;

  const summary = {
    at: new Date().toISOString(),
    runs: combos.length, scraped, upserted: unique.length, newListings: inserted, pruned,
    errors: errors.length, errorSample: errors.slice(0, 5),
  };
  await setMeta("last_refresh", summary.at);
  await setMeta("last_refresh_summary", JSON.stringify(summary));
  log(`[scrape] done: scraped ${scraped}, upserted ${unique.length} (${inserted} new), pruned ${pruned}, errors ${errors.length}`);
  return summary;
}
