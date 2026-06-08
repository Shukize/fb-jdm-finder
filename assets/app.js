/* JDM Finder — UI controller */
(function () {
  "use strict";
  const { MODELS, COUNTRIES, getListings } = window.JDM;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

  const LS = {
    filters: "jdm.filters.v2",
    settings: "jdm.settings.v2",
    saved: "jdm.saved.v2",
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let filters = load(LS.filters, { model: "all", country: "US", city: "", query: "", minPrice: "", maxPrice: "", sort: "newest" });
  let settings = load(LS.settings, { live: false, apifyToken: "", actorId: "" });
  let saved = load(LS.saved, []);
  let current = []; // currently displayed listings

  const fmtPrice = (n, cur) => cur + Number(n || 0).toLocaleString();
  const fmtMiles = (n, u) => (n ? Number(n).toLocaleString() + " " + u : "—");
  const ago = (d) => (d === 0 ? "today" : d === 1 ? "1 day ago" : d + " days ago");

  // ---------- shell ----------
  function buildShell() {
    const wrap = el("div", "wrap");
    wrap.innerHTML = `
      <header class="app">
        <h1>JDM Finder<span class="dot">.</span></h1>
        <span class="spacer"></span>
        <button class="iconbtn" id="savedBtn">★ Saved searches <span class="n" id="savedNew"></span></button>
        <button class="iconbtn" id="settingsBtn">⚙ Settings</button>
        <p class="tag">Browse live JDM listings by country — click any car for full details &amp; photos.</p>
      </header>

      <section class="toolbar">
        <div class="field"><label>Country</label><select id="f-country"></select></div>
        <div class="field"><label>Model</label><select id="f-model"></select></div>
        <div class="field"><label>City (live mode)</label><input id="f-city" placeholder="optional"/></div>
        <div class="field"><label>Min price</label><input id="f-min" type="number" placeholder="0" min="0"/></div>
        <div class="field"><label>Max price</label><input id="f-max" type="number" placeholder="any" min="0"/></div>
        <div class="field"><label>Sort</label><select id="f-sort">
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
        </select></div>
        <div class="field"><label>Search</label><input id="f-query" placeholder="keywords…"/></div>
        <div class="field go">
          <button class="btn" id="searchBtn">Search</button>
          <button class="btn ghost" id="saveBtn" title="Save this search">★</button>
        </div>
      </section>

      <div class="status" id="status"></div>
      <main class="grid" id="results"></main>
    `;
    document.body.appendChild(wrap);

    // backdrops / drawers
    document.body.insertAdjacentHTML("beforeend", `
      <div class="backdrop" id="detailBackdrop"><div class="modal"><button class="close" data-close>×</button><div class="detail" id="detailBody"></div></div></div>
      <div class="backdrop" id="settingsBackdrop"><div class="modal"><button class="close" data-close>×</button><div class="settings-body" id="settingsBody"></div></div></div>
      <aside class="drawer" id="drawer"></aside>
    `);

    // populate selects
    const cSel = $("#f-country");
    cSel.appendChild(new Option("All countries", "all"));
    COUNTRIES.forEach((c) => cSel.appendChild(new Option(c.name, c.code)));
    const mSel = $("#f-model");
    mSel.appendChild(new Option("All models", "all"));
    MODELS.forEach((m) => mSel.appendChild(new Option(m.name, m.key)));

    // hydrate fields
    cSel.value = filters.country; mSel.value = filters.model;
    $("#f-city").value = filters.city; $("#f-min").value = filters.minPrice;
    $("#f-max").value = filters.maxPrice; $("#f-sort").value = filters.sort;
    $("#f-query").value = filters.query;

    // events
    $("#searchBtn").onclick = runSearch;
    $("#saveBtn").onclick = saveCurrentSearch;
    $("#settingsBtn").onclick = openSettings;
    $("#savedBtn").onclick = openDrawer;
    $("#f-query").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
    document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModals));
    document.querySelectorAll(".backdrop").forEach((b) => b.addEventListener("click", (e) => { if (e.target === b) closeModals(); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModals(); closeDrawer(); } });
    refreshSavedBadge();
  }

  function readFilters() {
    filters = {
      country: $("#f-country").value, model: $("#f-model").value,
      city: $("#f-city").value.trim(), minPrice: $("#f-min").value.trim(),
      maxPrice: $("#f-max").value.trim(), sort: $("#f-sort").value, query: $("#f-query").value.trim(),
    };
    save(LS.filters, filters);
  }

  // ---------- search / render ----------
  async function runSearch(seenUpdater) {
    readFilters();
    const status = $("#status");
    status.innerHTML = `<span class="pill ${settings.live ? "live" : "sample"}">${settings.live ? "LIVE · Facebook" : "SAMPLE DATA"}</span> searching…`;
    try {
      current = await getListings(filters, settings);
      if (typeof seenUpdater === "function") seenUpdater(current);
      renderResults(current);
      const where = filters.country === "all" ? "all countries" : (COUNTRIES.find((c) => c.code === filters.country) || {}).name;
      status.innerHTML = `<span class="pill ${settings.live ? "live" : "sample"}">${settings.live ? "LIVE · Facebook" : "SAMPLE DATA"}</span> ${current.length} listing${current.length === 1 ? "" : "s"} · ${where}`;
    } catch (err) {
      current = [];
      renderResults([]);
      status.innerHTML = `<span class="pill err">ERROR</span> ${String(err.message || err)}`;
    }
  }

  function renderResults(items) {
    const grid = $("#results");
    grid.innerHTML = "";
    if (!items.length) {
      grid.appendChild(el("div", "empty", "No listings match. Try widening the price range, switching country, or choosing “All models.”"));
      return;
    }
    const seen = activeSeenSet();
    items.forEach((it) => {
      const card = el("article", "listing");
      const isNew = seen && !seen.has(it.id);
      card.innerHTML = `
        <div class="thumb" style="background-image:url('${(it.images[0] || "").replace(/'/g, "%27")}')">
          ${isNew ? '<span class="new">NEW</span>' : ""}
          <span class="count">${it.images.length} ◷ ${it.images.length} photo${it.images.length === 1 ? "" : "s"}</span>
        </div>
        <div class="meta">
          <div class="price">${fmtPrice(it.price, it.currency)}</div>
          <div class="title">${esc(it.title)}</div>
          <div class="sub">${esc(it.city || it.countryName || "")}${it.mileage ? " · " + fmtMiles(it.mileage, it.mileageUnit) : ""}${it.transmission ? " · " + it.transmission : ""}</div>
        </div>`;
      card.onclick = () => openDetail(it);
      grid.appendChild(card);
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- detail modal w/ gallery ----------
  function openDetail(it) {
    let idx = 0;
    const body = $("#detailBody");
    const specs = [
      ["Price", fmtPrice(it.price, it.currency)],
      ["Year", it.year || "—"],
      ["Mileage", it.mileage ? fmtMiles(it.mileage, it.mileageUnit) : "—"],
      ["Transmission", it.transmission || "—"],
      ["Location", [it.city, it.countryName].filter(Boolean).join(", ") || "—"],
      ["Posted", it.sample ? ago(it.postedDaysAgo) : "—"],
    ];
    body.innerHTML = `
      <div class="gallery">
        <img class="hero" id="hero" alt="${esc(it.title)}"/>
        <div class="navrow">
          <button class="nav" id="prev">‹</button>
          <span class="counter" id="counter"></span>
          <button class="nav" id="next">›</button>
        </div>
        <div class="thumbs" id="thumbs"></div>
      </div>
      <div class="details">
        <h2>${esc(it.title)}</h2>
        <div class="bigprice">${fmtPrice(it.price, it.currency)}</div>
        <ul class="specs">${specs.map((s) => `<li>${s[0]}<b>${esc(s[1])}</b></li>`).join("")}</ul>
        ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ""}
        <button class="savebtn" id="favBtn">★ Save this listing</button>
        <a class="fb-btn" href="${esc(it.url)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>
          View on Facebook
        </a>
      </div>`;
    const hero = $("#hero"), counter = $("#counter"), thumbs = $("#thumbs");
    const fallback = it.images[0] || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3C/svg%3E";
    function show(i) {
      idx = (i + it.images.length) % it.images.length;
      hero.src = it.images[idx] || fallback;
      counter.textContent = (idx + 1) + " / " + it.images.length;
      thumbs.querySelectorAll("img").forEach((t, k) => t.classList.toggle("active", k === idx));
    }
    hero.onerror = () => { hero.onerror = null; hero.src = fallback; };
    it.images.forEach((src, k) => { const t = el("img"); t.src = src; t.onclick = () => show(k); thumbs.appendChild(t); });
    $("#prev").onclick = () => show(idx - 1);
    $("#next").onclick = () => show(idx + 1);
    $("#favBtn").onclick = () => { saveListing(it); $("#favBtn").textContent = "★ Saved"; };
    show(0);
    $("#detailBackdrop").classList.add("show");
  }

  // ---------- saved searches ----------
  function searchLabel(f) {
    const m = f.model === "all" ? "All models" : (MODELS.find((x) => x.key === f.model) || {}).name;
    const c = f.country === "all" ? "all countries" : (COUNTRIES.find((x) => x.code === f.country) || {}).name;
    const price = [f.minPrice && "≥" + f.minPrice, f.maxPrice && "≤" + f.maxPrice].filter(Boolean).join(" ");
    return [m, "in " + c, price, f.query && '"' + f.query + '"'].filter(Boolean).join(" · ");
  }
  function saveCurrentSearch() {
    readFilters();
    const name = prompt("Name this saved search:", searchLabel(filters));
    if (name == null) return;
    const id = "ss-" + Date.now();
    const seenIds = current.map((x) => x.id);
    saved.unshift({ id, name: name || searchLabel(filters), filters: { ...filters }, seen: seenIds, lastRun: Date.now(), newCount: 0 });
    save(LS.saved, saved);
    refreshSavedBadge();
    openDrawer();
  }
  function activeSeenSet() {
    // if the current filters exactly match a saved search, use its seen set to flag NEW
    const match = saved.find((s) => JSON.stringify(s.filters) === JSON.stringify(filters));
    return match ? new Set(match.seen) : null;
  }
  async function runSaved(ss) {
    // apply its filters to the toolbar, then search; compute new vs seen
    Object.assign(filters, ss.filters);
    $("#f-country").value = filters.country; $("#f-model").value = filters.model;
    $("#f-city").value = filters.city || ""; $("#f-min").value = filters.minPrice || "";
    $("#f-max").value = filters.maxPrice || ""; $("#f-sort").value = filters.sort || "newest";
    $("#f-query").value = filters.query || "";
    closeDrawer();
    await runSearch((results) => {
      const seen = new Set(ss.seen || []);
      const fresh = results.filter((r) => !seen.has(r.id));
      ss.newCount = fresh.length;
      ss.seen = results.map((r) => r.id);
      ss.lastRun = Date.now();
      save(LS.saved, saved);
      refreshSavedBadge();
    });
  }
  function refreshSavedBadge() {
    const tot = saved.reduce((a, s) => a + (s.newCount || 0), 0);
    $("#savedNew").textContent = tot ? "(" + tot + " new)" : "";
  }
  function openDrawer() {
    const d = $("#drawer");
    d.innerHTML = `<h3>★ Saved searches</h3><p class="muted">Re-run any search to refresh and flag <b>new</b> listings since you last checked.</p>`;
    if (!saved.length) d.appendChild(el("p", "muted", "No saved searches yet. Set your filters and tap the ★ next to Search."));
    saved.forEach((ss) => {
      const item = el("div", "saved-item");
      item.innerHTML = `
        <div class="row1"><span class="name">${esc(ss.name)}</span>${ss.newCount ? `<span class="newbadge">${ss.newCount} new</span>` : ""}</div>
        <div class="desc">${esc(searchLabel(ss.filters))}<br>last checked ${ss.lastRun ? new Date(ss.lastRun).toLocaleString() : "never"}</div>
        <div class="acts"><button class="run">Run &amp; refresh</button><button class="del">Delete</button></div>`;
      item.querySelector(".run").onclick = () => runSaved(ss);
      item.querySelector(".del").onclick = () => { saved = saved.filter((x) => x.id !== ss.id); save(LS.saved, saved); refreshSavedBadge(); openDrawer(); };
      d.appendChild(item);
    });
    d.classList.add("show");
  }
  function closeDrawer() { $("#drawer").classList.remove("show"); }

  function saveListing(it) {
    const favs = load("jdm.favs.v1", []);
    if (!favs.find((x) => x.id === it.id)) { favs.unshift({ id: it.id, title: it.title, price: it.price, currency: it.currency, url: it.url, image: it.images[0] }); save("jdm.favs.v1", favs); }
  }

  // ---------- settings ----------
  function openSettings() {
    const b = $("#settingsBody");
    b.innerHTML = `
      <h2>⚙ Settings — live data</h2>
      <p class="note">By default the site shows <b>sample listings</b> so everything is browsable instantly. To pull <b>real Facebook Marketplace</b> listings, connect an <a href="https://apify.com" target="_blank" rel="noopener">Apify</a> account (free trial credits) and paste an actor + API token below. Facebook has no public API, so a scraper service is the only reliable source. Your token is stored only in this browser.</p>
      <div class="switch"><input type="checkbox" id="s-live" ${settings.live ? "checked" : ""}/><label for="s-live"><b>Use live Facebook data</b> (requires the fields below)</label></div>
      <div class="field"><label>Apify actor ID</label><input id="s-actor" placeholder="e.g. username~facebook-marketplace-scraper" value="${esc(settings.actorId)}"/></div>
      <div class="field"><label>Apify API token</label><input id="s-token" type="password" placeholder="apify_api_..." value="${esc(settings.apifyToken)}"/></div>
      <p class="note">Find an actor in the <a href="https://apify.com/store?search=facebook%20marketplace" target="_blank" rel="noopener">Apify Store</a> (search “facebook marketplace”). Copy its ID (the <code>owner~actor-name</code> shown on the actor page) and your token from <code>Settings → Integrations</code>. The data layer maps common field names automatically; tweak <code>assets/data.js → mapApifyItem</code> if your actor uses different keys.</p>
      <button class="btn" id="s-save">Save settings</button>`;
    $("#s-save").onclick = () => {
      settings = { live: $("#s-live").checked, actorId: $("#s-actor").value.trim(), apifyToken: $("#s-token").value.trim() };
      save(LS.settings, settings);
      closeModals();
      runSearch();
    };
    $("#settingsBackdrop").classList.add("show");
  }

  function closeModals() { document.querySelectorAll(".backdrop").forEach((b) => b.classList.remove("show")); }

  // ---------- boot ----------
  buildShell();
  runSearch();
})();
