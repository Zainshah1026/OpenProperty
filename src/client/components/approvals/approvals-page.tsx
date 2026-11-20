import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Phone, ShieldCheck, X } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

interface Approval {
  id: number;
  tool: string;
  summary: string;
  details: string | null;
  source: string | null;
  urgent: boolean;
  status: "pending" | "running" | "approved" | "declined" | "failed";
  result: string | null;
  decided_by: string | null;
  decided_at: string | null;
  called_at: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, string> = {
  approved: "bg-success-tint text-success",
  declined: "bg-muted text-muted-foreground",
  failed: "bg-destructive-tint text-destructive",
};

const when = (s: string | null) =>
  s ? new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z")).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Push on this device: off, on, or not possible (and why). */
function usePush() {
  const [state, setState] = useState<"checking" | "on" | "off" | "unsupported" | "install" | "blocked">("checking");
  const [calls, setCalls] = useState(false);

  useEffect(() => {
    (async () => {
      const k = await api<{ publicKey: string; calls: boolean }>("GET", "/api/push/key").catch(() => null);
      setCalls(!!k?.calls);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        const ios = /iphone|ipad/i.test(navigator.userAgent);
        const standalone = (navigator as { standalone?: boolean }).standalone || window.matchMedia("(display-mode: standalone)").matches;
        setState(ios && !standalone ? "install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    const { publicKey } = await api<{ publicKey: string }>("GET", "/api/push/key");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "blocked" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await api("POST", "/api/push/subscribe", sub.toJSON());
    setState("on");
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  return { state, calls, enable, disable };
}

export function ApprovalsPage() {
  const app = useApp();
  const [pending, setPending] = useState<Approval[]>([]);
  const [recent, setRecent] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const push = usePush();

  async function load() {
    try {
      const r = await api<{ pending: Approval[]; recent: Approval[] }>("GET", "/api/approvals");
      setPending(r.pending);
      setRecent(r.recent);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(a: Approval, action: "approve" | "decline") {
    setBusy(a.id);
    try {
      const r = await api<{ approval: Approval }>("POST", `/api/approvals/${a.id}/${action}`);
      setNote(r.approval.status === "approved" ? `Done: ${r.approval.result ?? a.summary}` : r.approval.status === "failed" ? `Didn't work: ${r.approval.result}` : "Declined.");
      if (r.approval.status === "approved") void app.refreshLookups().catch(() => {});
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setNote(ok);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <PageShell
      title="Approvals"
      meta={loading ? "Loading…" : pending.length ? `${pending.length} waiting for you` : "Nothing waiting"}
      width="max-w-3xl"
    >
      <div className="space-y-6 pb-10">
        <Card className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              Jarvis asks here before it changes anything. Urgent requests also ring your phone, and you can answer yes or no out loud. Every morning at 9 you also get the rent due in that day and the mortgages and other payments going out.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {push.state === "off" && (
              <Button size="sm" onClick={() => run(push.enable, "Notifications are on for this device.")}>
                <Bell className="size-4" /> Turn on notifications here
              </Button>
            )}
            {push.state === "on" && (
              <>
                <Badge variant="secondary"><Bell className="mr-1 size-3.5" /> Notifications on</Badge>
                <Button size="sm" variant="outline" onClick={() => run(() => api("POST", "/api/push/test"), "Test notification sent.")}>Send a test</Button>
                <Button size="sm" variant="outline" onClick={() => run(async () => {
                  const r = await api<{ sent?: number; note?: string }>("POST", "/api/jarvis/money-today/send");
                  if (r.note) throw new Error(r.note);
                }, "Today's rent and payments sent.")}>Today's money</Button>
                <Button size="sm" variant="ghost" onClick={() => run(push.disable, "Notifications off for this device.")}><BellOff className="size-4" /> Turn off</Button>
              </>
            )}
            {push.state === "install" && (
              <p className="text-sm">On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), open it from there, then come back to this page.</p>
            )}
            {push.state === "blocked" && <p className="text-sm">Notifications are blocked for this app. Allow them in the phone's Settings → Notifications, then reload.</p>}
            {push.state === "unsupported" && <p className="text-sm text-muted-foreground">This browser can't show notifications.</p>}
            {push.calls && (
              <Button size="sm" variant="outline" onClick={() => run(() => api("POST", "/api/jarvis/call-test"), "Calling you now…")}>
                <Phone className="size-4" /> Test a call
              </Button>
            )}
          </div>
          {note && <p className="text-sm font-medium text-primary">{note}</p>}
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Waiting for you</h2>
          {!loading && !pending.length && <p className="text-sm text-muted-foreground">Nothing to approve right now.</p>}
          {pending.map((a) => (
            <Card key={a.id} id={String(a.id)} className={cn("space-y-2 p-4", a.urgent && "border-destructive")}>
              <div className="flex flex-wrap items-center gap-2">
                {a.urgent && <Badge variant="destructive">Urgent</Badge>}
                <span className="text-xs text-muted-foreground">{when(a.created_at)}{a.source ? ` · ${a.source.replace(/^email:/, "email to ")}` : ""}{a.called_at ? " · called you" : ""}</span>
              </div>
              <p className="font-medium">{a.summary}</p>
              {a.details && <p className="whitespace-pre-line text-sm text-muted-foreground">{a.details}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" disabled={busy === a.id || a.status === "running"} onClick={() => decide(a, "approve")}>
                  <Check className="size-4" /> Approve
                </Button>
                <Button size="sm" variant="outline" disabled={busy === a.id || a.status === "running"} onClick={() => decide(a, "decline")}>
                  <X className="size-4" /> Decline
                </Button>
              </div>
            </Card>
          ))}
        </section>

        {!!recent.length && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recently decided</h2>
            {recent.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize", STATUS_TONE[a.status])}>{a.status}</span>
                <div className="min-w-0">
                  <p>{a.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {[a.decided_by, when(a.decided_at), a.status !== "declined" ? a.result : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </PageShell>
  );
}
