/* Shared catalog: the exact set of cars + countries the site targets.
   This MUST stay in sync with the frontend's assets/data.js MODELS/COUNTRIES.
   The frontend can also fetch it live from GET /api/catalog so the dropdowns
   never drift from what the server actually scrapes. */

/* `match` = tokens that qualify a listing as THIS model. A scraped listing is
   only kept (and tagged with this model) if its title/description contains one
   of these. This is what guarantees "select RX-7 → only RX-7s" even when the
   Facebook actor returns fuzzy/adjacent results. Keep tokens specific to the
   chassis so e.g. a plain "Mazda 3" never counts as an RX-7. */
export const MODELS = [
  { key: "rx7",        name: "Mazda RX-7",             query: "mazda rx7",              tag: "FC / FD · rotary", years: [1985, 2002], base: 22000,
    match: ["rx7", "rx-7", "rx 7", "fd3s", "fc3s", "fd rx", "fc rx", "savanna rx", "efini rx", "rx7 rotary"] },
  { key: "gt86",       name: "Toyota 86 / GR86",       query: "toyota 86",              tag: "ZN6 / ZN8",        years: [2013, 2024], base: 24000,
    match: ["gt86", "gt-86", "gr86", "gr-86", "toyota 86", "scion fr-s", "scion frs", "fr-s", "frs", "subaru brz", "brz", "zn6", "zn8"] },
  { key: "240sx",      name: "Nissan 240SX",           query: "nissan 240sx",           tag: "S13 / S14",        years: [1989, 1998], base: 16000,
    match: ["240sx", "240 sx", "silvia", "180sx", "200sx", "s13", "s14", "ka24", "sr20det"] },
  { key: "r32",        name: "Nissan Skyline R32",     query: "nissan skyline r32",     tag: "GT-R / GTS-T",     years: [1989, 1994], base: 38000,
    match: ["skyline r32", "r32 skyline", "r32 gtr", "r32 gt-r", "r32 gts", "nissan r32", "skyline gtr", "skyline gts", "rb26", "rb20det", "bnr32", "hcr32"] },
  { key: "supra",      name: "Toyota Supra",           query: "toyota supra",           tag: "MK3 / MK4 / A90",  years: [1986, 2024], base: 45000,
    match: ["supra", "mk3 supra", "mk4 supra", "mkiv supra", "a80", "a90", "a91", "2jz-gte", "2jzgte", "jza80"] },
  { key: "corolla",    name: "Toyota Corolla",         query: "toyota corolla",         tag: "AE86 & classic",   years: [1983, 2024], base: 9000,
    match: ["corolla", "ae86", "hachiroku", "trueno", "levin", "sprinter corolla", "corolla gts", "corolla sr5"] },
  { key: "celica",     name: "Toyota Celica",          query: "toyota celica",          tag: "GT-Four / GT-S",   years: [1990, 2006], base: 11000,
    match: ["celica", "gt-four", "gt four", "gtfour", "gt4 celica", "celica gts", "celica gt-s", "st205", "st185", "st162"] },
  { key: "talon",      name: "Eagle Talon",            query: "eagle talon",            tag: "TSi AWD · DSM",    years: [1990, 1998], base: 9000,
    match: ["eagle talon", "talon tsi", "talon esi", "talon awd", "talon dsm", "talon turbo", "plymouth laser", "eagle talon"] },
  { key: "eclipsegsx", name: "Mitsubishi Eclipse GSX", query: "mitsubishi eclipse gsx", tag: "AWD turbo · DSM",  years: [1990, 1999], base: 12000,
    match: ["eclipse gsx", "eclipse gst", "eclipse gs-t", "eclipse turbo", "mitsubishi eclipse", "4g63 eclipse", "eclipse spyder", "eclipse gs "] },
];

/* Listings whose TITLE contains any of these are dropped outright — they are
   clearly not the car (other product categories, or parts/accessories rather
   than a whole vehicle). Kept deliberately conservative so real cars survive. */
export const EXCLUDE = [
  "bicycle", "e-bike", "ebike", "e bike", "mountain bike", "dirt bike", "scooter",
  "sneaker", "yeezy", "jordan", "shoe", "cleats", "t-shirt", "hoodie", "jacket", "jersey",
  "drum", "guitar", "piano", "amplifier", "keyboard",
  "sofa", "couch", "loveseat", "mattress", "dresser", "nightstand", "lamp", "rug",
  "iphone", "ipad", "macbook", "laptop", "ps5", "xbox", "nintendo",
  "knife", "airsoft", "poster", "keychain", "sticker", "decal", "diecast", "hot wheels",
  "model kit", "rc car", "lawn mower", "generator", "motorhome",
];

// Normalize for token matching: lowercase, non-alphanumerics → single spaces,
// padded so we can test whole-token containment (" rx 7 " inside the haystack).
function norm(s) { return " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ") + " "; }

/* True if a scraped listing genuinely belongs to `model`.
   - rejected if the TITLE hits the EXCLUDE list (obvious non-car)
   - accepted only if TITLE+DESCRIPTION contains one of the model's match tokens */
export function matchesModel(title, description, model) {
  const titleN = norm(title);
  if (titleN.trim() === "") return false; // no title → untrustworthy, drop
  for (const x of EXCLUDE) if (titleN.includes(norm(x))) return false;
  const hay = norm(title + " " + (description || ""));
  for (const m of (model.match || [])) if (hay.includes(norm(m))) return true;
  return false;
}

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
