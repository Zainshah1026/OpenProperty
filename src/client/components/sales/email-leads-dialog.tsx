import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MailCheck, Send } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const CAMPAIGN = "vacant-properties-oct-2026";
const DEFAULT_FROM = "zain@chistiandco.com";
const DEFAULT_SUBJECT = "Do you have a property vacant?";
const DEFAULT_BODY = `Hi [First name],

Thank you for getting in touch with Chisti & Co about your property.

We're taking on new properties now and wanted to check: do you have anything vacant at the moment, or becoming vacant in the next few months?

We can help in whichever way suits you:

- Guaranteed rent: we pay you a fixed rent every month, even when the property is vacant, with no letting fees and the day-to-day management handled for you.
- Tenant finding: we find and reference a tenant for you, and you manage the tenancy yourself.
- Airbnb operators: we can match your property with a trusted company that rents it from you to run as an Airbnb.

If you have something, just reply with:
- the address
- the number of bedrooms
- when it's vacant
- which option you're interested in

and we'll come back to you with an offer.

Kind regards,`;

interface Job {
  total: number; sent: number; failed: number; skipped: number; current: string | null;
  running: boolean; cancelled: boolean; finished_at: string | null; error: string | null;
  failures: { name: string; email: string; error: string }[];
}
interface Status {
  enabled: boolean;
  senders: string[];
  job: Job | null;
  sent: { lead_id: number; email: string; sent_at: string; campaign: string }[];
  to_send?: number; already?: number; no_email?: number; opted_out?: number;
  recipients?: { id: number; name: string; email: string; first_name: string | null }[];
}

const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

/** Write the email, send yourself a test, then send it to every lettings lead one by one. */
export function EmailLeadsDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (o: boolean) => void; onSent: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [busy, setBusy] = useState<"" | "test" | "send">("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showList, setShowList] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await api<Status>("GET", `/api/lettings-leads/email/status?campaign=${CAMPAIGN}`);
      setS(st);
      return st;
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setConfirming(false);
    load();
  }, [open, load]);

  // While sending, check progress every few seconds.
  useEffect(() => {
    if (!open || !s?.job?.running) { if (timer.current) clearInterval(timer.current); timer.current = null; return; }
    if (!timer.current) timer.current = setInterval(async () => {
      const st = await load();
      if (st && !st.job?.running) onSent();
    }, 3000);
    return () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  }, [open, s?.job?.running, load, onSent]);

  const payload = { campaign: CAMPAIGN, from, subject, body };
  const fromOk = !!s?.senders.some((x) => x.toLowerCase() === from.toLowerCase());

  async function sendTest() {
    setBusy("test");
    setMsg(null);
    try {
      const r = await api<{ sent_to: string; sample_name: string | null }>("POST", "/api/lettings-leads/email/test", payload);
      setMsg({ tone: "ok", text: `Test sent to ${r.sent_to}${r.sample_name ? `, written as it will look for ${r.sample_name}` : ""}. Check it in your inbox before sending to everyone.` });
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function sendAll() {
    setBusy("send");
    setMsg(null);
    try {
      await api("POST", "/api/lettings-leads/email/send", payload);
      setConfirming(false);
      await load();
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function stop() {
    await api("POST", "/api/lettings-leads/email/stop").catch(() => {});
    load();
  }

  const job = s?.job;
  const minutes = s?.to_send ? Math.max(1, Math.round((s.to_send * 10) / 60)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Email landlords</DialogTitle></DialogHeader>

        {s && !s.enabled ? (
          <p className="rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">Email sending isn't set up on the server yet.</p>
        ) : job && (job.running || job.finished_at) ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 font-medium">
              {job.running ? <Loader2 className="size-4 animate-spin text-primary" /> : <CheckCircle2 className="size-4 text-success" />}
              {job.running ? `Sending… ${job.sent + job.failed + job.skipped} of ${job.total}` : job.cancelled ? "Stopped" : "Finished"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${job.total ? ((job.sent + job.failed + job.skipped) / job.total) * 100 : 0}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {job.sent} sent{job.failed ? ` · ${job.failed} failed` : ""}{job.skipped ? ` · ${job.skipped} already had it` : ""}
              {job.running && job.current ? ` · now: ${job.current}` : ""}
            </p>
            {job.running && <p className="text-xs text-muted-foreground">One email every 10 seconds, so your mailbox isn't flagged for bulk mail. You can close this window; sending carries on.</p>}
            {job.error && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive">{job.error}</p>}
            {job.failures.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{job.failures.length} couldn't be sent</summary>
                <ul className="mt-2 grid gap-1">{job.failures.map((f) => <li key={f.email}><strong>{f.name}</strong> ({f.email}): {f.error}</li>)}</ul>
              </details>
            )}
            <DialogFooter className="mt-2">
              {job.running ? <Button variant="destructive" onClick={stop}>Stop sending</Button> : (s?.to_send ?? 0) > 0 && <Button variant="secondary" onClick={() => setS({ ...s!, job: null })}>Send to the {s!.to_send} remaining</Button>}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block" htmlFor="em-from">From</Label>
                <select id="em-from" className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)}>
                  {[DEFAULT_FROM, ...(s?.senders ?? []).filter((x) => x.toLowerCase() !== DEFAULT_FROM)].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                {s && !fromOk && <p className="mt-1 text-xs text-destructive">{from} isn't connected to the app.</p>}
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="em-subject">Subject</Label>
                <Input id="em-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="mb-1 block" htmlFor="em-body">Message</Label>
              <Textarea id="em-body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                [First name] becomes each landlord's first name. Your signature with the Chisti &amp; Co. logo goes underneath, then a line saying they can reply "stop".
              </p>
            </div>

            <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
              {s ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium"><MailCheck className="mr-1 inline size-4 text-primary" />{s.to_send} landlords will get it</span>
                    {!!s.already && <span className="text-muted-foreground">{s.already} already sent</span>}
                    {!!s.no_email && <span className="text-muted-foreground">{s.no_email} without an email address</span>}
                    {!!s.opted_out && <span className="text-muted-foreground">{s.opted_out} not interested or asked not to be emailed</span>}
                    {!!s.recipients?.length && <button type="button" className="text-primary underline" onClick={() => setShowList((v) => !v)}>{showList ? "Hide list" : "See who"}</button>}
                  </div>
                  {showList && (
                    <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-muted-foreground">
                      {s.recipients!.map((r) => <li key={r.id}>{r.first_name ? `Hi ${r.first_name}` : "Hello"} · {r.name} · {r.email}</li>)}
                    </ul>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Counting recipients…</span>
              )}
            </div>

            {msg && <p className={cn("rounded-md px-3 py-2 text-sm", msg.tone === "ok" ? "bg-success-tint text-success" : "bg-destructive-tint text-destructive")} role={msg.tone === "err" ? "alert" : "status"}>{msg.text}</p>}

            <DialogFooter className="mt-1 flex-wrap gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="secondary" onClick={sendTest} disabled={!!busy || !fromOk}>{busy === "test" ? "Sending test…" : `Send me a test (${from.split("@")[0]}@)`}</Button>
              {confirming ? (
                <Button onClick={sendAll} disabled={!!busy || !s?.to_send}><Send /> {busy === "send" ? "Starting…" : `Yes, send ${s?.to_send} emails`}</Button>
              ) : (
                <Button onClick={() => setConfirming(true)} disabled={!!busy || !s?.to_send || !fromOk}><Send /> Send to {s?.to_send ?? "…"} landlords</Button>
              )}
            </DialogFooter>
            {confirming && <p className="text-right text-xs text-muted-foreground">This sends {s?.to_send} separate emails from {from}, about {minutes} minute{minutes === 1 ? "" : "s"} in all. Each goes to your Sent folder.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
