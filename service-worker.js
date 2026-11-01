/* =========================================================
   Matcha Journal — service worker
   Strategy:
     - Precache the app shell on install.
     - Navigations / index.html: network-first, fall back to
       cache when offline (so new releases arrive immediately
       but the app still opens with no connection).
     - Everything else same-origin: cache-first, backfill.
     - Google Fonts: stale-while-revalidate runtime cache.
   The page can post "skipWaiting" to activate a new worker
   at once (index.html does this), and the in-app Force
   Update button deletes all caches + unregisters us.
   ========================================================= */
"use strict";

const SW_VERSION = "1.5.0"; /* keep in step with app-version in index.html */
const CACHE_NAME = "matcha-shell-v" + SW_VERSION;
const FONT_CACHE = "matcha-fonts-v1";

const SHELL = [
  "./",
  "./index.html",
  "./assistant-inbox-core.js?v=1",
  "./assistant-inbox.js?v=1",
  "./assistant-inbox.css?v=1",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Tokens and delivery traffic must never enter the app cache.
  if (new URL(req.url).origin !== self.location.origin && !/fonts\.g(static|oogleapis)\.com$/.test(new URL(req.url).hostname)) return;
  if (new URL(req.url).pathname.includes("/inbox/") || new URL(req.url).pathname.endsWith("/delivery-key.json")) return;

  const url = new URL(req.url);

  /* In-app update check fetches index.html with ?_check= and
     cache:no-store — let it hit the network untouched. */
  if (url.searchParams.has("_check")) return;

  /* Navigations and the shell document: network-first. */
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((hit) => hit || Response.error())
        )
    );
    return;
  }

  /* Google Fonts: stale-while-revalidate. */
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => { cache.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || refresh;
      })
    );
    return;
  }

  /* Other same-origin assets (manifest, icons): cache-first. */
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
  }
});

