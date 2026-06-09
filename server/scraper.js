/* Apify-backed Facebook Marketplace scraper (server-side).

   Facebook has no public Marketplace API and blocks direct scraping, so this
   drives an Apify "Facebook Marketplace" actor with the OWNER's token (an env
   var on Render). Visitors never see or supply a token. Results are mapped to
   our listing shape and upserted into Neon.

   Actors differ in their input/output keys — `pick()` accepts the common ones.
   If your chosen actor uses different names, extend the arrays in mapItem /
   buildInput. */

import { MODELS, COUNTRIES, MODEL_BY_KEY, COUNTRY_BY_CODE, parseList, matchesModel } from "./catalog.js";
import { upsertListings, setMeta, pruneStale, clearLive } from "./db.js";
import { isEbayConfigured, fetchEbay } from "./ebay.js";

const APIFY_TOKEN = (process.env.APIFY_TOKEN || "").trim();
const APIFY_ACTOR = (process.env.APIFY_ACTOR || "").trim();
const MAX_ITEMS = Number(process.env.SCRAPE_MAX_ITEMS || 40);
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY || 2));
const PRUNE_DAYS = Number(process.env.SCRAPE_PRUNE_DAYS || 14);
const RUN_TIMEOUT = Number(process.env.SCRAPE_RUN_TIMEOUT || 120); // seconds, per actor run

export function isConfigured() {
  return !!(APIFY_TOKEN && APIFY_ACTOR);
}

// All data sources currently configured. Facebook (Apify) is primary; eBay is
// a free, always-on fallback so listings still appear when Apify's free monthly
// credit is spent. Each source.run(model, country) → { kept, fetched }.
function activeSources() {
  const s = [];
  if (isConfigured()) s.push({ name: "facebook", run: runActor });
  if (isEbayConfigured()) s.push({ name: "ebay", run: fetchEbay });
  return s;
}
export function anySourceConfigured() { return isConfigured() || isEbayConfigured(); }

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
// Read a dotted nested path, e.g. "listing_price.formatted_amount".
function deepGet(o, path) { return path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o); }
function firstDef(...vals) { for (const v of vals) if (v != null && v !== "") return v; return undefined; }
function yearFromText(s) { const m = String(s || "").match(/\b(19[6-9]\d|20[0-3]\d)\b/); return m ? +m[1] : ""; }
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
  imgs = imgs.map((x) => (typeof x === "string" ? x : pick(x, ["url", "src", "uri", "image"]))).filter(Boolean);
  // official apify/facebook-marketplace-scraper shape (nested):
  const primary = deepGet(it, "primary_listing_photo.image.uri");
  if (primary) imgs.unshift(primary);
  if (Array.isArray(it.listing_photos)) for (const p of it.listing_photos) { const u = deepGet(p, "image.uri"); if (u) imgs.push(u); }
  return [...new Set(imgs)];
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
  // Title: never default to the model name — we match relevance on this, so a
  // fabricated title would let junk through. Empty title ⇒ dropped downstream.
  const title = pick(it, ["title", "name", "marketplace_listing_title"]) || "";
  const description = firstDef(
    pick(it, ["description", "text"]),
    deepGet(it, "redactedDescription.text"),
    pick(it, ["redactedDescription", "marketplace_listing_description"])
  ) || "";
  // City: official actor nests it; guard against `location` being an object.
  let city = firstDef(
    deepGet(it, "location.reverse_geocode.city"),
    deepGet(it, "location.reverse_geocode.city_page.display_name"),
    pick(it, ["city", "locationText", "place"]),
    typeof it.location === "string" ? it.location : undefined
  ) || "";
  const state = deepGet(it, "location.reverse_geocode.state");
  if (city && state && !city.includes(state)) city = `${city}, ${state}`;
  // Prefer the already-formatted price (real dollars). The official actor's
  // listing_price.amount is in minor units (cents) — using it directly inflates
  // prices 100×, so it's only a last resort.
  const price = parsePrice(firstDef(
    pick(it, ["price", "priceAmount", "listingPrice", "formattedPrice"]),
    deepGet(it, "listing_price.formatted_amount"),
    deepGet(it, "listing_price.amount"),
    pick(it, ["amount"])
  ));
  return {
    id,
    model: model.key,
    modelName: model.name,
    query: model.query,
    title,
    price,
    currency: pick(it, ["currencySymbol"]) || country.cur,
    curCode: pick(it, ["currency", "currencyCode"]) || country.curCode,
    country: country.code,
    countryName: country.name,
    city,
    year: parseNum(pick(it, ["year"])) || yearFromText(title),
    mileage: parseNum(pick(it, ["mileage", "odometer"])),
    mileageUnit: country.unit,
    transmission: pick(it, ["transmission"]) || "",
    description,
    images: mapImages(it),
    url,
    seller: pick(it, ["sellerName", "seller"]) || deepGet(it, "marketplace_listing_seller.name") || "",
    postedAt: postedAt ? postedAt.toISOString() : null,
    sample: false,
  };
}

// Facebook Marketplace search URL for a city + query (what the official
// apify/facebook-marketplace-scraper expects inside startUrls).
function citySlug(city) { return String(city || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function searchUrl(model, country) {
  return `https://www.facebook.com/marketplace/${citySlug(country.cities[0])}/search/?query=${encodeURIComponent(model.query)}`;
}

function buildInput(model, country) {
  const url = searchUrl(model, country);
  const loc = country.cities[0];
  return {
    // ── official apify/facebook-marketplace-scraper (verified schema) ──
    startUrls: [{ url }],
    resultsLimit: MAX_ITEMS,
    includeListingDetails: true,
    // ── compatibility for keyword-style community actors (ignored by the
    //    official actor; one of these matches whatever actor is configured) ──
    query: model.query, search: model.query, keyword: model.query,
    keywords: model.query, searchTerm: model.query, searchQuery: model.query, q: model.query,
    location: loc, city: loc, country: country.name, countryCode: country.code,
    maxItems: MAX_ITEMS, count: MAX_ITEMS, maxResults: MAX_ITEMS,
    urls: [url], listingUrls: [{ url }],
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
  const raw = await res.json();
  const mapped = Array.isArray(raw) ? raw.map((it, i) => mapItem(it, model, country, i)) : [];
  // Relevance gate: only keep listings that genuinely are this model. This is
  // what makes "select RX-7 → only RX-7s" true regardless of actor noise.
  const kept = mapped.filter((x) => matchesModel(x.title, x.description, model));
  return { kept, fetched: mapped.length };
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
export async function runRefresh({ log = console.log, reset = false } = {}) {
  const sources = activeSources();
  if (!sources.length) throw new Error("No data source configured — set EBAY_CLIENT_ID/SECRET (free) and/or APIFY_TOKEN + APIFY_ACTOR.");
  const models = targetModels();
  const countries = targetCountries();
  const combos = [];
  for (const m of models) for (const c of countries) combos.push({ m, c });

  log(`[scrape] starting: ${models.length} models × ${countries.length} countries = ${combos.length} combos × sources [${sources.map((s) => s.name).join(", ")}] (concurrency ${CONCURRENCY})`);
  let fetched = 0, kept = 0, inserted = 0;
  const errors = [];
  const all = [];

  await pool(
    combos,
    CONCURRENCY,
    // Run every configured source for this combo and merge. One source failing
    // (e.g. Apify out of credit) doesn't lose the other's results.
    async ({ m, c }) => {
      let fetchedN = 0; const keptItems = []; const srcErrors = [];
      for (const s of sources) {
        try { const r = await s.run(m, c); fetchedN += r.fetched; keptItems.push(...r.kept); }
        catch (e) { srcErrors.push(`${s.name}: ${e.message}`); }
      }
      return { fetched: fetchedN, kept: keptItems, srcErrors };
    },
    (result, { m, c }, err) => {
      if (err) { errors.push(`${m.key}/${c.code}: ${err.message}`); log(`[scrape] ✗ ${m.key}/${c.code}: ${err.message}`); return; }
      fetched += result.fetched;
      kept += result.kept.length;
      all.push(...result.kept);
      for (const se of result.srcErrors) errors.push(`${m.key}/${c.code} ${se}`);
      log(`[scrape] ✓ ${m.key}/${c.code}: kept ${result.kept.length}/${result.fetched} relevant${result.srcErrors.length ? ` (${result.srcErrors.length} src err)` : ""}`);
    }
  );

  // de-dupe across combos by id (keep only listings with a usable link/photo)
  const byId = new Map();
  for (const it of all) if (it.images.length || it.url) byId.set(it.id, it);
  const unique = [...byId.values()];

  // `reset` wipes the old table first — used to purge previously-stored junk.
  // Guard: only wipe when we actually scraped replacements, so a failed/empty
  // run can't blank the site.
  let cleared = 0;
  if (reset && unique.length) { cleared = await clearLive(); log(`[scrape] reset: cleared ${cleared} existing rows`); }

  if (unique.length) {
    const r = await upsertListings(unique);
    inserted = r.inserted;
  }
  const pruned = PRUNE_DAYS > 0 ? await pruneStale(PRUNE_DAYS) : 0;

  const summary = {
    at: new Date().toISOString(),
    runs: combos.length, fetched, kept, upserted: unique.length, newListings: inserted,
    cleared, pruned, errors: errors.length, errorSample: errors.slice(0, 5),
  };
  await setMeta("last_refresh", summary.at);
  await setMeta("last_refresh_summary", JSON.stringify(summary));
  log(`[scrape] done: fetched ${fetched}, kept ${kept} relevant, upserted ${unique.length} (${inserted} new), cleared ${cleared}, pruned ${pruned}, errors ${errors.length}`);
  return summary;
}
