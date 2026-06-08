/* JDM Finder — data layer.
   Talks to the JDM Finder API (Render + Neon + Apify) for real Facebook
   Marketplace listings. If the API is unset or unreachable, it falls back to
   built-in sample listings so the site is never blank.
   Exposes a single global: window.JDM */
(function () {
  "use strict";

  const MODELS = [
    { key: "rx7",        name: "Mazda RX-7",             query: "mazda rx7",              tag: "FC / FD · rotary",  years: [1985, 2002], base: 22000 },
    { key: "gt86",       name: "Toyota 86 / GR86",       query: "toyota 86",              tag: "ZN6 / ZN8",         years: [2013, 2024], base: 24000 },
    { key: "240sx",      name: "Nissan 240SX",           query: "nissan 240sx",           tag: "S13 / S14",         years: [1989, 1998], base: 16000 },
    { key: "r32",        name: "Nissan Skyline R32",     query: "nissan skyline r32",     tag: "GT-R / GTS-T",      years: [1989, 1994], base: 38000 },
    { key: "supra",      name: "Toyota Supra",           query: "toyota supra",           tag: "MK3 / MK4 / A90",   years: [1986, 2024], base: 45000 },
    { key: "corolla",    name: "Toyota Corolla",         query: "toyota corolla",         tag: "AE86 & classic",    years: [1983, 2024], base: 9000  },
    { key: "celica",     name: "Toyota Celica",          query: "toyota celica",          tag: "GT-Four / GT-S",    years: [1990, 2006], base: 11000 },
    { key: "talon",      name: "Eagle Talon",            query: "eagle talon",            tag: "TSi AWD · DSM",     years: [1990, 1998], base: 9000  },
    { key: "eclipsegsx", name: "Mitsubishi Eclipse GSX", query: "mitsubishi eclipse gsx", tag: "AWD turbo · DSM",   years: [1990, 1999], base: 12000 },
  ];

  const COUNTRIES = [
    { code: "US", name: "United States",  cur: "$", curCode: "USD", mult: 1.0,   unit: "mi", cities: ["Los Angeles", "Houston", "Miami", "Seattle", "Chicago"] },
    { code: "CA", name: "Canada",         cur: "$", curCode: "CAD", mult: 1.35,  unit: "km", cities: ["Toronto", "Vancouver", "Montreal"] },
    { code: "GB", name: "United Kingdom", cur: "£", curCode: "GBP", mult: 0.82,  unit: "mi", cities: ["London", "Manchester", "Birmingham"] },
    { code: "AU", name: "Australia",      cur: "$", curCode: "AUD", mult: 1.5,   unit: "km", cities: ["Sydney", "Melbourne", "Brisbane"] },
    { code: "JP", name: "Japan",          cur: "¥", curCode: "JPY", mult: 145,   unit: "km", cities: ["Tokyo", "Osaka", "Nagoya"] },
    { code: "DE", name: "Germany",        cur: "€", curCode: "EUR", mult: 0.92,  unit: "km", cities: ["Berlin", "Munich", "Hamburg"] },
  ];

  // ---- deterministic RNG so sample data is stable across reloads ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- on-brand SVG "photo" generator (works offline; clearly a sample) ----
  const BODIES = ["#e23b3b", "#2f6fed", "#f2c14e", "#19c37d", "#9b6dff", "#e8eaed", "#1b1f2a", "#ff8a3d"];
  const SKIES = [["#1d2740", "#0c1020"], ["#3a2740", "#140d18"], ["#16323a", "#0a161a"], ["#2a3550", "#10131f"]];
  function carImage(bodyColor, sky, label, flip) {
    const [s1, s2] = sky;
    const car =
      "<path d='M6 34c0-3 2-5 5-5h4l9-12c2-3 5-4 8-4h33c4 0 8 2 11 5l8 8 16 3c4 1 7 4 7 8v3c0 2-2 4-4 4h-9a9 9 0 0 1-18 0H45a9 9 0 0 1-18 0h-9c-3 0-6-3-6-6z' fill='" + bodyColor + "'/>" +
      "<path d='M33 24l-6 8h25V18H43c-4 0-7 2-10 6z' fill='rgba(255,255,255,.30)'/>" +
      "<path d='M64 32h19l-6-6c-3-3-7-4-11-4h-2z' fill='rgba(255,255,255,.30)'/>" +
      "<circle cx='36' cy='38' r='7' fill='#0c0e14'/><circle cx='36' cy='38' r='3.2' fill='#c7ccd6'/>" +
      "<circle cx='90' cy='38' r='7' fill='#0c0e14'/><circle cx='90' cy='38' r='3.2' fill='#c7ccd6'/>";
    const g = flip ? "<g transform='translate(800,0) scale(-1,1)'>" : "<g>";
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + s1 + "'/><stop offset='1' stop-color='" + s2 + "'/></linearGradient></defs>" +
      "<rect width='800' height='600' fill='url(#g)'/>" +
      "<ellipse cx='400' cy='430' rx='300' ry='30' fill='rgba(0,0,0,.25)'/>" +
      g + "<g transform='translate(110,210) scale(4.2)'>" + car + "</g></g>" +
      "<text x='34' y='560' font-family='Segoe UI, Arial, sans-serif' font-size='30' font-weight='600' fill='rgba(255,255,255,.85)'>" + label + "</text>" +
      "<text x='766' y='560' text-anchor='end' font-family='Segoe UI, Arial, sans-serif' font-size='20' fill='rgba(255,255,255,.45)'>sample photo</text>" +
      "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function imageSet(seedStr, label) {
    const rnd = mulberry32(hashStr(seedStr));
    const n = 3 + Math.floor(rnd() * 3); // 3–5 photos
    const out = [];
    for (let i = 0; i < n; i++) {
      const body = BODIES[Math.floor(rnd() * BODIES.length)];
      const sky = SKIES[Math.floor(rnd() * SKIES.length)];
      out.push(carImage(body, sky, label, i % 2 === 1));
    }
    return out;
  }

  const TRIMS = ["", "Turbo ", "GT ", "Limited ", "Track ", "Widebody ", "Stock "];
  const COND = ["Clean title, well maintained.", "Built motor, lots of receipts.", "Project car, runs and drives.", "One owner, garage kept.", "Fresh paint, new tires.", "Needs minor work, priced to sell."];

  function makeSample() {
    const list = [];
    MODELS.forEach((m) => {
      const rnd = mulberry32(hashStr(m.key) ^ 0x9e3779b9);
      const order = COUNTRIES.map((c, i) => i).sort(() => rnd() - 0.5).slice(0, 3 + Math.floor(rnd() * 2));
      order.forEach((ci) => {
        const c = COUNTRIES[ci];
        const count = 2 + Math.floor(rnd() * 3); // 2–4 per country
        for (let i = 0; i < count; i++) {
          const id = "sample-" + m.key + "-" + c.code + "-" + i;
          const year = m.years[0] + Math.floor(rnd() * (m.years[1] - m.years[0] + 1));
          const trim = TRIMS[Math.floor(rnd() * TRIMS.length)];
          const usd = Math.round((m.base * (0.55 + rnd() * 1.4)) / 250) * 250;
          const price = Math.round((usd * c.mult) / 50) * 50;
          const mileage = (20 + Math.floor(rnd() * 160)) * 1000;
          const city = c.cities[Math.floor(rnd() * c.cities.length)];
          const trans = rnd() > 0.35 ? "Manual" : "Automatic";
          const days = Math.floor(rnd() * 30);
          const title = year + " " + m.name.replace(/ \/.*/, "") + " " + trim;
          list.push({
            id, model: m.key, modelName: m.name, query: m.query,
            title: title.trim(), price, currency: c.cur, curCode: c.curCode,
            country: c.code, countryName: c.name, city,
            year, mileage, mileageUnit: c.unit, transmission: trans,
            postedDaysAgo: days,
            description: trim ? (trim + m.name + ". " + COND[Math.floor(rnd() * COND.length)]) : (m.name + ". " + COND[Math.floor(rnd() * COND.length)]),
            images: imageSet(id, m.name),
            url: "https://www.facebook.com/marketplace/search/?query=" + encodeURIComponent(m.query),
            seller: "Marketplace seller",
            sample: true,
          });
        }
      });
    });
    return list;
  }

  const SAMPLE = makeSample();

  function applyFilters(items, f) {
    let out = items.slice();
    if (f.model && f.model !== "all") out = out.filter((x) => x.model === f.model);
    if (f.country && f.country !== "all") out = out.filter((x) => x.country === f.country);
    if (f.query) { const q = f.query.toLowerCase(); out = out.filter((x) => (x.title + " " + x.modelName + " " + x.city).toLowerCase().includes(q)); }
    if (f.minPrice) out = out.filter((x) => x.price >= +f.minPrice);
    if (f.maxPrice) out = out.filter((x) => x.price <= +f.maxPrice);
    switch (f.sort) {
      case "price_asc": out.sort((a, b) => a.price - b.price); break;
      case "price_desc": out.sort((a, b) => b.price - a.price); break;
      default: out.sort((a, b) => (a.postedDaysAgo || 0) - (b.postedDaysAgo || 0)); // newest
    }
    return out;
  }

  // ---------- API client ----------
  function apiBase() {
    const cfg = ((window.JDM_CONFIG && window.JDM_CONFIG.apiBase) || "").trim().replace(/\/+$/, "");
    if (cfg) return cfg;
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3000";
    if (location.protocol === "http:" || location.protocol === "https:") return ""; // same-origin
    return null; // file:// with no config → offline only
  }

  function buildQuery(f) {
    const qs = new URLSearchParams();
    if (f.model && f.model !== "all") qs.set("model", f.model);
    if (f.country && f.country !== "all") qs.set("country", f.country);
    if (f.minPrice) qs.set("minPrice", f.minPrice);
    if (f.maxPrice) qs.set("maxPrice", f.maxPrice);
    if (f.query) qs.set("q", f.query);
    if (f.sort) qs.set("sort", f.sort);
    return qs.toString();
  }

  async function getHealth() {
    const base = apiBase();
    if (base === null) return null;
    try {
      const res = await fetch(base + "/api/health", { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // Returns { items, live, lastRefresh, source }
  async function getListings(f) {
    const base = apiBase();
    if (base !== null) {
      try {
        const res = await fetch(base + "/api/listings?" + buildQuery(f), { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("API " + res.status);
        const data = await res.json();
        return {
          items: Array.isArray(data.items) ? data.items : [],
          live: !!data.live,
          lastRefresh: data.lastRefresh || null,
          source: data.live ? "live" : "sample-server",
        };
      } catch (e) {
        console.warn("[JDM] API unreachable — showing offline sample listings:", e.message);
      }
    }
    return { items: applyFilters(SAMPLE, f), live: false, lastRefresh: null, source: "sample-offline" };
  }

  window.JDM = { MODELS, COUNTRIES, SAMPLE, getListings, getHealth, applyFilters, apiBase };
})();
