# JDM Finder

A streamlined, public site for finding specific JDM / sport-compact cars for sale on **Facebook Marketplace** — laid out right on the page with full photos, full details, and a one-tap **View on Facebook** button. Filter by country, price, and keyword; save searches and get a **NEW** badge for listings that appeared since you last checked.

**Models tracked:** Mazda RX-7 · Toyota 86/GR86 · Nissan 240SX · Nissan Skyline R32 · Toyota Supra · Toyota Corolla · Toyota Celica · Eagle Talon · Mitsubishi Eclipse GSX.

**Live demo (frontend):** https://shukize.github.io/fb-jdm-finder/

---

## How it works

```
GitHub Pages (this repo root)            Render web service (server/)          Neon Postgres
  index.html + assets/   ──fetch──▶   Express API   ──Apify scrape (cron)──▶   listings table
                                       /api/listings · /api/catalog · /api/refresh
```

- **Frontend** — a zero-build static site (plain HTML/CSS/JS) hosted on GitHub Pages. It calls the API and lays out the results. If the API is unreachable it shows built-in **sample** listings so the page is never blank.
- **Backend** ([`server/`](server/)) — a small Express API on **Render** that scrapes Facebook Marketplace on a schedule (via Apify), stores listings in **Neon Postgres**, and serves them to everyone. **Visitors configure nothing** — there are no tokens in the browser.

> **Why a scraper service?** Facebook has **no public Marketplace API** and blocks direct scraping (especially from datacenter IPs like Render's). A managed scraper — [Apify](https://apify.com) — is the only reliable way to get real listings server-side.

---

## Deploy it (≈15 minutes)

You need three free accounts: **Neon** (database), **Render** (API host), **Apify** (the Facebook data source). The frontend stays on GitHub Pages.

### 1. Neon — create the database
1. In the [Neon console](https://console.neon.tech), create a project.
2. Open **Connection Details** and copy the **pooled** connection string. It looks like:
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
   Keep it — it's your `DATABASE_URL`. (The schema is created automatically on first boot.)

### 2. Apify — get the Facebook data source
1. Make a free [Apify](https://apify.com) account (includes trial credits).
2. In the [Apify Store](https://apify.com/store?search=facebook%20marketplace), open a **"Facebook Marketplace"** scraper actor. Copy its **actor ID** — the `owner~actor-name` shown on the actor page (e.g. `apify~facebook-marketplace-scraper`). That's `APIFY_ACTOR`.
3. From **Settings → Integrations**, copy your **API token**. That's `APIFY_TOKEN`.

### 3. Render — deploy the API
**Option A — Blueprint (recommended).** This repo ships [`render.yaml`](render.yaml).
1. In Render: **New → Blueprint**, connect this repo.
2. Render reads `render.yaml`, creates the `jdm-finder-api` web service, and prompts you to paste the secrets: `DATABASE_URL`, `APIFY_TOKEN`, `APIFY_ACTOR`. (`REFRESH_SECRET` is auto-generated.)
3. Deploy. Your API URL will be something like `https://jdm-finder-api.onrender.com`.

**Option B — manual.** New → **Web Service** → this repo. Set **Root Directory** = `server`, **Build** = `npm install`, **Start** = `npm start`, then add the env vars from [`server/.env.example`](server/.env.example).

Verify it's up: open `https://YOUR-SERVICE.onrender.com/api/health` — you should see `{"ok":true,...}`.

### 4. Connect the frontend
1. Edit [`assets/config.js`](assets/config.js) and set `apiBase` to your Render URL (no trailing slash):
   ```js
   window.JDM_CONFIG = { apiBase: "https://jdm-finder-api.onrender.com" };
   ```
2. Commit & push. GitHub Pages redeploys and the site starts showing live listings.

That's it — the server scrapes on boot and then every 6 hours; visitors just open the site.

---

## First populate & manual refresh

- **On first boot** with Apify + DB configured, the server kicks off a scrape automatically (runs in the background; sample data shows until it finishes).
- **Trigger a refresh any time** with the secret:
  ```bash
  curl "https://YOUR-SERVICE.onrender.com/api/refresh?secret=YOUR_REFRESH_SECRET"
  ```
- **From your machine** (uses `server/.env`):
  ```bash
  cd server && cp .env.example .env   # fill in the values
  npm install && npm run refresh
  ```

### Keeping it fresh & awake
Render's free web service sleeps after inactivity, which pauses the in-process cron. To guarantee scheduled refreshes, point a free external pinger (e.g. [cron-job.org](https://cron-job.org)) at:
`https://YOUR-SERVICE.onrender.com/api/refresh?secret=YOUR_REFRESH_SECRET`
every few hours — it both refreshes the data and keeps the service awake.

---

## Configuration

All backend config is via env vars (see [`server/.env.example`](server/.env.example)). Key ones:

| Var | What it does | Default |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | — (required for live data) |
| `APIFY_TOKEN` / `APIFY_ACTOR` | Facebook data source | — (required for live data) |
| `REFRESH_SECRET` | Protects `/api/refresh` | — |
| `SCRAPE_MODELS` | Which cars to scrape (`all` or comma keys) | `all` |
| `SCRAPE_COUNTRIES` | Which countries (codes) — **each one multiplies Apify cost** | `US` |
| `REFRESH_CRON` | Auto-scrape schedule | `0 */6 * * *` (every 6h) |
| `SCRAPE_MAX_ITEMS` | Listings per model/country run | `40` |
| `CORS_ORIGINS` | Allowed origins (`*` or a list) | `*` |

**Cost note:** scraping is `models × countries` actor runs per refresh. Start with `SCRAPE_COUNTRIES=US` and widen once you've watched your Apify credit usage.

> Actors differ in their input/output field names. The mapper in [`server/scraper.js`](server/scraper.js) (`mapItem` / `buildInput`) accepts the common ones; tweak it if your chosen actor uses different keys.

---

## API reference

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Status: db connected, apify configured, live count, last refresh |
| `GET /api/catalog` | The models + countries lists (for the dropdowns) |
| `GET /api/listings?model=&country=&minPrice=&maxPrice=&q=&sort=` | Filtered/sorted listings (live, else sample) |
| `GET\|POST /api/refresh?secret=` | Trigger a scrape (requires `REFRESH_SECRET`) |

---

## Local preview

**Frontend only** (uses sample data, or live if `apiBase` points at a running API):
```bash
npx serve .        # or: python -m http.server 8080
```

**Full stack locally:**
```bash
cd server
cp .env.example .env     # fill in DATABASE_URL, APIFY_TOKEN, APIFY_ACTOR, REFRESH_SECRET
npm install && npm start # API on http://localhost:3000
```
Then serve the frontend from the repo root; on `localhost` it auto-targets `http://localhost:3000`.

---

## Project layout

```
index.html              app shell (loads config → data → app)
assets/config.js        ← set your Render API URL here
assets/data.js          models, countries, API client, offline sample fallback
assets/app.js           UI: search, grid, detail gallery, saved searches, About
assets/styles.css       styling
render.yaml             Render Blueprint for the API
server/
  server.js             Express API + scheduled refresh
  scraper.js            Apify scraper + model×country orchestration
  db.js                 Neon Postgres schema + queries
  catalog.js            shared models/countries (mirrors assets/data.js)
  sample.js             server-side sample fallback
  refresh-cli.js        `npm run refresh`
  .env.example          backend configuration
```

---

## Note

Personal/educational tool that deep-links into and (in live mode) reads public Facebook Marketplace listings via a third-party scraper. Respect Facebook's Terms, Apify's Terms, and your local laws; use responsibly and at your own risk.
