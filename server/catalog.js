/* Shared catalog: the exact set of cars + countries the site targets.
   This MUST stay in sync with the frontend's assets/data.js MODELS/COUNTRIES.
   The frontend can also fetch it live from GET /api/catalog so the dropdowns
   never drift from what the server actually scrapes. */

export const MODELS = [
  { key: "rx7",        name: "Mazda RX-7",             query: "mazda rx7",              tag: "FC / FD · rotary", years: [1985, 2002], base: 22000 },
  { key: "gt86",       name: "Toyota 86 / GR86",       query: "toyota 86",              tag: "ZN6 / ZN8",        years: [2013, 2024], base: 24000 },
  { key: "240sx",      name: "Nissan 240SX",           query: "nissan 240sx",           tag: "S13 / S14",        years: [1989, 1998], base: 16000 },
  { key: "r32",        name: "Nissan Skyline R32",     query: "nissan skyline r32",     tag: "GT-R / GTS-T",     years: [1989, 1994], base: 38000 },
  { key: "supra",      name: "Toyota Supra",           query: "toyota supra",           tag: "MK3 / MK4 / A90",  years: [1986, 2024], base: 45000 },
  { key: "corolla",    name: "Toyota Corolla",         query: "toyota corolla",         tag: "AE86 & classic",   years: [1983, 2024], base: 9000  },
  { key: "celica",     name: "Toyota Celica",          query: "toyota celica",          tag: "GT-Four / GT-S",   years: [1990, 2006], base: 11000 },
  { key: "talon",      name: "Eagle Talon",            query: "eagle talon",            tag: "TSi AWD · DSM",    years: [1990, 1998], base: 9000  },
  { key: "eclipsegsx", name: "Mitsubishi Eclipse GSX", query: "mitsubishi eclipse gsx", tag: "AWD turbo · DSM",  years: [1990, 1999], base: 12000 },
];

export const COUNTRIES = [
  { code: "US", name: "United States",  cur: "$", curCode: "USD", mult: 1.0,  unit: "mi", cities: ["Los Angeles", "Houston", "Miami", "Seattle", "Chicago"] },
  { code: "CA", name: "Canada",         cur: "$", curCode: "CAD", mult: 1.35, unit: "km", cities: ["Toronto", "Vancouver", "Montreal"] },
  { code: "GB", name: "United Kingdom", cur: "£", curCode: "GBP", mult: 0.82, unit: "mi", cities: ["London", "Manchester", "Birmingham"] },
  { code: "AU", name: "Australia",      cur: "$", curCode: "AUD", mult: 1.5,  unit: "km", cities: ["Sydney", "Melbourne", "Brisbane"] },
  { code: "JP", name: "Japan",          cur: "¥", curCode: "JPY", mult: 145,  unit: "km", cities: ["Tokyo", "Osaka", "Nagoya"] },
  { code: "DE", name: "Germany",        cur: "€", curCode: "EUR", mult: 0.92, unit: "km", cities: ["Berlin", "Munich", "Hamburg"] },
];

export const MODEL_BY_KEY = Object.fromEntries(MODELS.map((m) => [m.key, m]));
export const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

/* Parse a comma-separated env list into a validated subset of codes/keys.
   Empty / "all" / unset => return the full list of valid values. */
export function parseList(envValue, validValues, fallbackAll) {
  if (!envValue || String(envValue).trim().toLowerCase() === "all") {
    return fallbackAll ? validValues.slice() : [];
  }
  const set = new Set(validValues);
  return String(envValue)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => set.has(s));
}
