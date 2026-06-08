/* Server-side sample listings — an in-memory fallback served by the API
   when the database has no live (scraped) listings yet, so the site is never
   blank. Mirrors the frontend's offline generator; everything is clearly
   marked `sample: true`. Output shape matches the live API response. */

import { MODELS, COUNTRIES } from "./catalog.js";

// deterministic RNG so sample data is stable across restarts
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

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
  const n = 3 + Math.floor(rnd() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(carImage(BODIES[Math.floor(rnd() * BODIES.length)], SKIES[Math.floor(rnd() * SKIES.length)], label, i % 2 === 1));
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
      const count = 2 + Math.floor(rnd() * 3);
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
        const title = (year + " " + m.name.replace(/ \/.*/, "") + " " + trim).trim();
        list.push({
          id, model: m.key, modelName: m.name, query: m.query,
          title, price, currency: c.cur, curCode: c.curCode,
          country: c.code, countryName: c.name, city,
          year, mileage, mileageUnit: c.unit, transmission: trans,
          postedDaysAgo: days,
          description: (trim ? trim + m.name : m.name) + ". " + COND[Math.floor(rnd() * COND.length)],
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

export const SAMPLE = makeSample();
