// Makes the dashboard installable as an app. It deliberately caches nothing:
// portfolio figures should always be live, and nothing private is stored on
// the device. Offline, it shows a short message instead of a browser error.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b7cc2;color:#fff;text-align:center;padding:16px"><div><h2>You\'re offline</h2><p>Connect to the internet to see the portfolio.</p></div>',
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});
