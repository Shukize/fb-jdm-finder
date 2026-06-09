/* Free, always-on data source: the eBay Browse API.

   Unlike Facebook/Craigslist/BaT (which block server-side access and need a
   paid proxy like Apify), eBay offers an official API with a generous free tier
   (~5,000 calls/day) — so this runs for $0 forever. We restrict to eBay Motors
   category 6001 (Cars & Trucks), which returns whole vehicles, not parts.

   Setup (free): create an eBay developer account, make a production keyset, and
   set EBAY_CLIENT_ID + EBAY_CLIENT_SECRET on Render. Nothing else required. */

import { matchesModel } from "./catalog.js";

const CLIENT_ID = (process.env.EBAY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.EBAY_CLIENT_SECRET || "").trim();
const MAX_ITEMS = Math.min(Number(process.env.SCRAPE_MAX_ITEMS || 40), 200);

export function isEbayConfigured() { return !!(CLIENT_ID && CLIENT_SECRET); }

// Our country codes → eBay buyer marketplaces. eBay has no JP buyer
// marketplace, so JP gets no eBay results (Apify FB can still cover it).
const MARKETPLACE = { US: "EBAY_US", CA: "EBAY_CA", GB: "EBAY_GB", AU: "EBAY_AU", DE: "EBAY_DE" };
const CARS_TRUCKS_CATEGORY = "6001"; // eBay Motors → Cars & Trucks (whole vehicles)
const CUR_SYMBOL = { USD: "$", CAD: "$", AUD: "$", GBP: "£", EUR: "€", JPY: "¥" };

function yearFromText(s) { const m = String(s || "").match(/\b(19[6-9]\d|20[0-3]\d)\b/); return m ? +m[1] : ""; }

// ---- OAuth (client-credentials application token, cached ~2h) ----
let tokenCache = { token: null, exp: 0 };
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error("eBay OAuth " + res.status + ": " + (await res.text().catch(() => "")).slice(0, 200));
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 };
  return tokenCache.token;
}

function mapEbayItem(it, model, country) {
  const rawId = String(it.itemId || it.legacyItemId || it.itemWebUrl || "");
  const id = "ebay-" + rawId.replace(/[^a-zA-Z0-9]/g, "").slice(-48);
  const price = it.price ? Math.round(parseFloat(it.price.value || 0)) : 0;
  const loc = it.itemLocation || {};
  const city = [loc.city, loc.stateOrProvince].filter(Boolean).join(", ") || loc.country || "";
  const img = (it.image && it.image.imageUrl) ||
    (Array.isArray(it.thumbnailImages) && it.thumbnailImages[0] && it.thumbnailImages[0].imageUrl) || "";
  const title = it.title || "";
  return {
    id,
    model: model.key,
    modelName: model.name,
    query: model.query,
    title,
    price,
    currency: (it.price && CUR_SYMBOL[it.price.currency]) || country.cur,
    curCode: (it.price && it.price.currency) || country.curCode,
    country: country.code,
    countryName: country.name,
    city,
    year: yearFromText(title),
    mileage: "",
    mileageUnit: country.unit,
    transmission: "",
    description: it.shortDescription || "",
    images: img ? [img] : [],
    url: it.itemWebUrl || it.itemAffiliateWebUrl || "",
    seller: (it.seller && it.seller.username) || "",
    postedAt: null,
    sample: false,
  };
}

/* Fetch listings for one model in one country from eBay Motors.
   Returns { kept, fetched } where kept passed the per-model relevance filter. */
export async function fetchEbay(model, country) {
  const marketplace = MARKETPLACE[country.code];
  if (!marketplace) return { kept: [], fetched: 0 }; // unsupported country (e.g. JP)
  const token = await getToken();
  const params = new URLSearchParams({
    q: model.query,
    category_ids: CARS_TRUCKS_CATEGORY,
    limit: String(MAX_ITEMS),
    sort: "newlyListed",
  });
  const res = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?" + params.toString(), {
    headers: {
      Authorization: "Bearer " + token,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error("eBay Browse " + res.status + ": " + (await res.text().catch(() => "")).slice(0, 200));
  const j = await res.json();
  const items = Array.isArray(j.itemSummaries) ? j.itemSummaries : [];
  const mapped = items.map((it) => mapEbayItem(it, model, country));
  const kept = mapped.filter((x) => matchesModel(x.title, x.description, model));
  return { kept, fetched: mapped.length };
}
