# JDM Finder

Browse Facebook Marketplace JDM/sport-compact listings by country — full photos, full details, and a one-tap **View on Facebook** button. Includes saved searches that flag **new** listings since you last checked.

Models: Mazda RX-7 · Toyota 86/GR86 · Nissan 240SX · Nissan Skyline R32 · Toyota Supra · Toyota Corolla · Toyota Celica · Eagle Talon · Mitsubishi Eclipse GSX.

**Live demo:** https://shukize.github.io/fb-jdm-finder/

## How it works

It's a zero-build static site (plain HTML/CSS/JS), so it hosts anywhere — GitHub Pages, Netlify, Vercel, or just by opening `index.html`.

- **Sample mode (default):** ships with realistic generated listings so the whole UI — country filter, detail gallery, saved searches — is browsable instantly with nothing to configure.
- **Live mode:** pulls real Facebook Marketplace listings via an [Apify](https://apify.com) scraper actor. Facebook has **no public Marketplace API** and blocks browser scraping, so a scraper service is the only reliable source.

## Turn on live Facebook data

1. Make a free [Apify](https://apify.com) account (trial credits included).
2. In the [Apify Store](https://apify.com/store?search=facebook%20marketplace), pick a "Facebook Marketplace" scraper actor. Copy its **actor ID** (the `owner~actor-name` on the actor page).
3. Copy your **API token** from `Settings → Integrations`.
4. In the site, open **⚙ Settings**, tick **Use live Facebook data**, paste the actor ID + token, and save. The token is stored only in your browser (`localStorage`); it is never committed or sent anywhere except Apify.

Actors differ slightly in their input/output. The data layer ([`assets/data.js`](assets/data.js)) maps common field names automatically — if your actor uses different keys, adjust `mapApifyItem` / `buildApifyInput`.

## Local preview

```bash
# from the project folder
npx serve .        # or: python -m http.server 8080
```

Then open the printed URL. (Opening `index.html` directly works too, but Live mode needs `http(s)://` for some browsers' fetch rules.)

## Project layout

```
index.html            app shell
assets/styles.css     styling
assets/data.js        models, countries, sample data, Apify provider
assets/app.js         UI: search, grid, detail gallery, saved searches, settings
```

## Note

Personal/educational tool that deep-links into and (in live mode) reads public Facebook Marketplace listings. Respect Facebook's Terms and your local laws; use responsibly and at your own risk.
