/* ───────────────────────────────────────────────────────────────────────────
   JDM Finder — frontend configuration.

   Set `apiBase` to your Render API URL (no trailing slash). This is the only
   thing you normally edit. After you deploy the server on Render it gives you
   a URL like https://jdm-finder-api.onrender.com — paste it here, commit, and
   GitHub Pages will start showing live listings.

   • Leave it as "" to use the same origin (only correct if the API also serves
     this page).
   • On localhost it auto-falls back to http://localhost:3000.
   • If the API can't be reached, the site shows built-in sample listings so it
     is never blank.
   ─────────────────────────────────────────────────────────────────────────── */
window.JDM_CONFIG = {
  apiBase: "https://jdm-finder-api.onrender.com",
};
