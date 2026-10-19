import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserRound } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: "admin" | "member";
  mailboxes: string[];
  active: boolean;
  last_login: string | null;
}

// ── My account: change your own password ───────────────────────────

export function MyAccountTab() {
  const { me } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (next !== again) return setMsg({ ok: false, text: "The new passwords don't match." });
    setBusy(true);
    setMsg(null);
    try {
      await api("POST", "/api/me/password", { current, next });
      setCurrent(""); setNext(""); setAgain("");
      setMsg({ ok: true, text: "Password changed. Your other devices have been signed out." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;
  return (
    <Card className="max-w-xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <UserRound className="size-5 text-primary" />
        <div>
          <div className="font-semibold">{me.name}</div>
          <div className="text-xs text-muted-foreground">{me.username} · {me.role === "admin" ? "Admin" : "Member"}</div>
        </div>
      </div>
      <a href="/logout" className="mb-5 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
        Sign out
      </a>
      <div className="mb-5">
        <div className="section-label mb-1">Mailboxes you can read</div>
        {me.mailboxes.length ? (
          <div className="flex flex-wrap gap-1.5">{me.mailboxes.map((m) => <span key={m} className="chip">{m}</span>)}</div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet. An admin can add them under Users.</p>
        )}
      </div>
      {me.setup ? (
        <p className="rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          You're using the temporary setup login. Create your own admin account in the Users tab, then sign in with it. The setup login stops working once an admin account exists.
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="section-label">Change password</div>
          <div><Label className="mb-1 block" htmlFor="pw-cur">Current password</Label><Input id="pw-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div><Label className="mb-1 block" htmlFor="pw-new">New password (at least 8 characters)</Label><Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div><Label className="mb-1 block" htmlFor="pw-again">New password again</Label><Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          {msg && <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")} role="status">{msg.text}</p>}
          <div><Button onClick={save} disabled={busy || !current || next.length < 8}><KeyRound className="h-4 w-4" /> Change password</Button></div>
        </div>
      )}
    </Card>
  );
}

// ── Users: admins add people and choose their mailboxes ────────────

export function UsersTab() {
  const { me, setError } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined); // null = new

  const load = useCallback(async () => {
    try {
      const d = await api<{ users: UserRow[]; mailboxes: string[] }>("GET", "/api/users");
      setUsers(d.users);
      setMailboxes(d.mailboxes);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  if (me?.role !== "admin") return <Card className="p-6 text-sm text-muted-foreground">Only admins can manage users.</Card>;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">Users</h2>
          <p className="text-xs text-muted-foreground">Everyone sees the same properties, invoices and sales. Mailboxes are private: each person only sees the ones ticked for them.</p>
        </div>
        <Button size="sm" onClick={() => setEditing(null)}><Plus className="mr-1 h-4 w-4" /> Add person</Button>
      </div>
      {me.setup && (
        <p className="m-4 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning">
          Start by adding <b>yourself</b> as an <b>Admin</b>. Once an admin account exists, this temporary setup login stops working.
        </p>
      )}
      {users.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No one added yet.</div>
      ) : (
        <ul className="divide-y">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => setEditing(u)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {u.name}
                    {u.role === "admin" && <Badge variant="brand"><ShieldCheck className="size-3" /> Admin</Badge>}
                    {!u.active && <Badge variant="neutral">Disabled</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.username}{u.last_login ? ` · last signed in ${formatDate(u.last_login)}` : " · never signed in"}</div>
                </div>
                <div className="flex flex-wrap gap-1">{u.mailboxes.map((m) => <span key={m} className="chip">{m}</span>)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <UserDialog user={editing} mailboxes={mailboxes} selfId={me.id} onClose={(changed) => { setEditing(undefined); if (changed) load(); }} />
    </Card>
  );
}

function UserDialog({ user, mailboxes, selfId, onClose }: { user: UserRow | null | undefined; mailboxes: string[]; selfId: number; onClose: (changed: boolean) => void }) {
  const open = user !== undefined;
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [boxes, setBoxes] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? "");
    setUsername(user?.username ?? "");
    setPassword("");
    setRole(user?.role ?? "member");
    setBoxes(user?.mailboxes ?? []);
    setActive(user?.active ?? true);
    setMsg(null);
  }, [open, user]);

  const allBoxes = [...new Set([...mailboxes, ...boxes])];
  const toggle = (m: string) => setBoxes(boxes.includes(m) ? boxes.filter((x) => x !== m) : [...boxes, m]);

  function generatePassword() {
    // Easy to read out over the phone: no 0/O or 1/l/I.
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(10);
    crypto.getRandomValues(bytes);
    setPassword(Array.from(bytes, (b) => chars[b % chars.length]).join(""));
  }

  async function save() {
    const missing: string[] = [];
    if (!name.trim()) missing.push("a name");
    if (!user && !username.trim()) missing.push("a username");
    else if (!user && username.trim().length < 2) missing.push("a username of at least 2 characters");
    if (!user && password.length < 8) missing.push(password ? `a password of at least 8 characters (${8 - password.length} more)` : "a temporary password");
    if (user && password && password.length < 8) missing.push(`a new password of at least 8 characters (${8 - password.length} more)`);
    if (missing.length) {
      setMsg(`Please add ${missing.join(" and ")}.`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (user) {
        await api("PUT", `/api/users/${user.id}`, { name, role, mailboxes: boxes, active, ...(password ? { password } : {}) });
      } else {
        await api("POST", "/api/users", { name, username, password, role, mailboxes: boxes });
      }
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api("DELETE", `/api/users/${user!.id}`);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{user ? `Edit ${user.name}` : "Add a person"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="mb-1 block">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zain" /></div>
            <div>
              <Label className="mb-1 block">Username (used to sign in)</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!!user} autoCapitalize="none" autoComplete="off" placeholder="e.g. sara" />
              {!user && <p className="mt-1 text-[11px] text-muted-foreground">Any name they'll remember. It doesn't need to be an email address.</p>}
            </div>
            <div>
              <Label className="mb-1 block">{user ? "Reset password (leave blank to keep)" : "Temporary password (at least 8 characters)"}</Label>
              <div className="flex gap-2">
                <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoCapitalize="none" spellCheck={false} />
                <Button type="button" variant="ghost" onClick={generatePassword}>Generate</Button>
              </div>
              {password.length > 0 && password.length < 8 && <p className="mt-1 text-[11px] text-warning">{8 - password.length} more character{8 - password.length === 1 ? "" : "s"} needed</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">Give it to them in person or by phone; they can change it under Settings → My account.</p>
            </div>
            <div>
              <Label className="mb-1 block">Role</Label>
              <div className="flex gap-2">
                {(["member", "admin"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRole(r)} className={cn("rounded-md border px-3 py-1.5 text-sm", role === r ? "border-primary bg-brand-tint font-medium" : "hover:bg-muted")}>
                    {r === "admin" ? "Admin (can manage users)" : "Member"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1 block">Mailboxes they can read <span className="font-normal text-muted-foreground">(optional: leave all unticked if they have no email)</span></Label>
              {allBoxes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No mailboxes connected yet. Add MAIL_USER / MAIL_PASSWORD (and _2, _3…) in Render first.</p>
              ) : (
                <div className="grid gap-1.5">
                  {allBoxes.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={boxes.includes(m)} onChange={() => toggle(m)} className="size-4 accent-[var(--primary)]" />
                      {m}{!mailboxes.includes(m) && <span className="text-xs text-warning">(not connected)</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {user && user.id !== selfId && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />
                Account active (untick to block sign-in without deleting)
              </label>
            )}
            {msg && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{msg}</p>}
          </div>
          <DialogFooter className="mt-2">
            {user && user.id !== selfId && <Button variant="destructive" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{user ? "Save" : "Add person"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {user && <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${user.name}?`} description="They won't be able to sign in. This cannot be undone." onConfirm={remove} />}
    </>
  );
}
