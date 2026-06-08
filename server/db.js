/* Neon Postgres data layer: schema, upserts, filtered queries, and a tiny
   key/value meta table (used for the "last refreshed" timestamp). */

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("[db] DATABASE_URL is not set — live listings are disabled, the API will serve sample data only.");
}

// Neon requires SSL. `ssl: { rejectUnauthorized: false }` is the standard,
// working setting for Neon's pooled connection string.
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  : null;

export function hasDb() {
  return !!pool;
}

export async function initSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id            TEXT PRIMARY KEY,
      model         TEXT,
      model_name    TEXT,
      query         TEXT,
      title         TEXT,
      price         NUMERIC,
      currency      TEXT,
      cur_code      TEXT,
      country       TEXT,
      country_name  TEXT,
      city          TEXT,
      year          INTEGER,
      mileage       NUMERIC,
      mileage_unit  TEXT,
      transmission  TEXT,
      description   TEXT,
      images        JSONB,
      url           TEXT,
      seller        TEXT,
      posted_at     TIMESTAMPTZ,
      sample        BOOLEAN DEFAULT FALSE,
      first_seen    TIMESTAMPTZ DEFAULT now(),
      last_seen     TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_listings_model    ON listings(model);
    CREATE INDEX IF NOT EXISTS idx_listings_country  ON listings(country);
    CREATE INDEX IF NOT EXISTS idx_listings_price    ON listings(price);
    CREATE INDEX IF NOT EXISTS idx_listings_seen     ON listings(last_seen);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export async function getMeta(key) {
  if (!pool) return null;
  const r = await pool.query("SELECT value FROM meta WHERE key = $1", [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

export async function setMeta(key, value) {
  if (!pool) return;
  await pool.query(
    "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, String(value)]
  );
}

export async function countLive() {
  if (!pool) return 0;
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM listings WHERE sample = FALSE");
  return r.rows[0].n;
}

/* Upsert a batch of mapped listings. `last_seen` always bumps so we can later
   prune stale rows; `first_seen` is preserved on conflict (it's what makes the
   NEW badge meaningful). Returns the number of rows that were brand-new. */
export async function upsertListings(items) {
  if (!pool || !items.length) return { inserted: 0, total: items.length };
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO listings
          (id, model, model_name, query, title, price, currency, cur_code,
           country, country_name, city, year, mileage, mileage_unit, transmission,
           description, images, url, seller, posted_at, sample, last_seen)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
         ON CONFLICT (id) DO UPDATE SET
           model = EXCLUDED.model, model_name = EXCLUDED.model_name, query = EXCLUDED.query,
           title = EXCLUDED.title, price = EXCLUDED.price, currency = EXCLUDED.currency,
           cur_code = EXCLUDED.cur_code, country = EXCLUDED.country, country_name = EXCLUDED.country_name,
           city = EXCLUDED.city, year = EXCLUDED.year, mileage = EXCLUDED.mileage,
           mileage_unit = EXCLUDED.mileage_unit, transmission = EXCLUDED.transmission,
           description = EXCLUDED.description, images = EXCLUDED.images, url = EXCLUDED.url,
           seller = EXCLUDED.seller, posted_at = EXCLUDED.posted_at, last_seen = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          it.id, it.model, it.modelName, it.query, it.title, it.price, it.currency, it.curCode,
          it.country, it.countryName, it.city, it.year || null, it.mileage || null, it.mileageUnit, it.transmission,
          it.description, JSON.stringify(it.images || []), it.url, it.seller,
          it.postedAt || null, !!it.sample,
        ]
      );
      if (r.rows[0] && r.rows[0].inserted) inserted++;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { inserted, total: items.length };
}

/* Delete live rows not seen in the most recent `keepDays` days, so sold /
   removed listings eventually drop off. */
export async function pruneStale(keepDays = 14) {
  if (!pool) return 0;
  const r = await pool.query(
    "DELETE FROM listings WHERE sample = FALSE AND last_seen < now() - ($1 || ' days')::interval",
    [String(keepDays)]
  );
  return r.rowCount;
}

function rowToListing(row) {
  const postedAt = row.posted_at ? new Date(row.posted_at) : null;
  const postedDaysAgo = postedAt ? Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 86400000)) : null;
  return {
    id: row.id,
    model: row.model || "",
    modelName: row.model_name || "",
    query: row.query || "",
    title: row.title || "",
    price: row.price != null ? Number(row.price) : 0,
    currency: row.currency || "$",
    curCode: row.cur_code || "",
    country: row.country || "",
    countryName: row.country_name || "",
    city: row.city || "",
    year: row.year || "",
    mileage: row.mileage != null ? Number(row.mileage) : "",
    mileageUnit: row.mileage_unit || "mi",
    transmission: row.transmission || "",
    postedDaysAgo,
    postedAt: postedAt ? postedAt.toISOString() : null,
    description: row.description || "",
    images: Array.isArray(row.images) ? row.images : [],
    url: row.url || "#",
    seller: row.seller || "",
    sample: !!row.sample,
  };
}

/* Filtered + sorted query of LIVE listings, built safely with bound params. */
export async function queryLive(f = {}) {
  if (!pool) return [];
  const where = ["sample = FALSE"];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("$$", "$" + params.length)); };

  if (f.model && f.model !== "all") add("model = $$", f.model);
  if (f.country && f.country !== "all") add("country = $$", f.country);
  if (f.minPrice) add("price >= $$", Number(f.minPrice));
  if (f.maxPrice) add("price <= $$", Number(f.maxPrice));
  if (f.query) add("(title || ' ' || COALESCE(model_name,'') || ' ' || COALESCE(city,'')) ILIKE $$", "%" + f.query + "%");

  let orderBy = "COALESCE(posted_at, first_seen) DESC NULLS LAST"; // newest
  if (f.sort === "price_asc") orderBy = "price ASC";
  else if (f.sort === "price_desc") orderBy = "price DESC";

  const limit = Math.min(Math.max(Number(f.limit) || 500, 1), 1000);
  const sql = `SELECT * FROM listings WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ${limit}`;
  const r = await pool.query(sql, params);
  return r.rows.map(rowToListing);
}
