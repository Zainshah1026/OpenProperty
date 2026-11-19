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

// Jarvis notifications: approvals waiting for a yes, and alerts. Approve and
// Decline buttons show where the device supports them (not on iPhone, where
// tapping opens the Approvals page instead).
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data ? event.data.text() : "" }; }
  const options = {
    body: msg.body || "",
    tag: msg.tag,
    icon: "/brand/apple-touch-icon.png",
    badge: "/brand/apple-touch-icon.png",
    data: { url: msg.url || "/approvals", approvalId: msg.approvalId || null },
    requireInteraction: !!msg.approvalId,
    actions: msg.approvalId ? [{ action: "approve", title: "Approve" }, { action: "decline", title: "Decline" }] : [],
  };
  event.waitUntil(self.registration.showNotification(msg.title || "Jarvis", options));
});

self.addEventListener("notificationclick", (event) => {
  const { url, approvalId } = event.notification.data || {};
  event.notification.close();
  if (approvalId && (event.action === "approve" || event.action === "decline")) {
    event.waitUntil(
      fetch(`/api/approvals/${approvalId}/${event.action}`, { method: "POST", credentials: "same-origin" })
        .then((r) => r.json().catch(() => ({})))
        .then((out) =>
          self.registration.showNotification("Jarvis", {
            body: out.error ? `Couldn't do that: ${out.error}` : out.approval && out.approval.status === "approved" ? `Done. ${out.approval.result || ""}` : "Okay, declined.",
            tag: `approval-${approvalId}`,
          }),
        )
        .catch(() => self.clients.openWindow(url || "/approvals")),
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { w.navigate(url || "/approvals"); return w.focus(); }
      }
      return self.clients.openWindow(url || "/approvals");
    }),
  );
});
