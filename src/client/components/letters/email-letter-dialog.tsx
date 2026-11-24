import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Letter } from "@/types";

interface Defaults { to: string; from: string | null; senders: string[]; subject: string }

/** Email a letter to the tenant from one of the company mailboxes. */
export function EmailLetterDialog({ letter, open, onOpenChange, onSent }: {
  letter: Letter;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent: (l: Letter, to: string) => void;
}) {
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [senders, setSenders] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<Defaults>("GET", `/api/letters/${letter.id}/email`)
      .then((d) => {
        setTo(d.to);
        setFrom(d.from ?? "");
        setSenders(d.senders);
        setSubject(d.subject);
        const first = (letter.tenant_name ?? "").trim().split(/\s+/)[0];
        setMessage(`${first ? `Hi ${first},` : "Hello,"}\n\nPlease find your letter below.\n\nKind regards,`);
      })
      .catch((err) => setError((err as Error).message));
  }, [open, letter.id, letter.tenant_name]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ letter: Letter; to: string }>("POST", `/api/letters/${letter.id}/email`, { to, from: from || undefined, subject, message });
      onSent(r.letter, r.to);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email this letter</DialogTitle>
          <DialogDescription>The letter goes in the body of the email, and a copy is saved in that mailbox's Sent folder.</DialogDescription>
        </DialogHeader>
        <form onSubmit={send} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="letter-to">To</Label>
            <Input id="letter-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="tenant@example.com" />
            {!to && <p className="text-xs text-muted-foreground">No email saved for this tenant. Type one in.</p>}
          </div>
          {senders.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="letter-from">From</Label>
              <select id="letter-from" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {senders.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="letter-subject">Subject</Label>
            <Input id="letter-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="letter-note">Message above the letter</Label>
            <Textarea id="letter-note" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !to || !subject}><Send /> {busy ? "Sending…" : "Send email"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
