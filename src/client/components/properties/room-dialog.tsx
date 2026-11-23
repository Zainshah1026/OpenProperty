import { useEffect, useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Room } from "@/types";

const STATUSES = [
  { value: "", label: "—" },
  { value: "on_time", label: "Paying on time" },
  { value: "in_arrears", label: "In arrears" },
  { value: "missed", label: "Missed a payment" },
  { value: "empty", label: "Room empty" },
];
const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

/** Add a room, or change who's in it and what they pay. Saved in the app and kept over the sheet sync. */
export function RoomDialog({ open, onOpenChange, propertyId, room, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: number;
  room?: Room & { tenant_email?: string | null };
  onSaved: () => void;
}) {
  const [f, setF] = useState({ room: "", tenant_name: "", tenant_email: "", rent: "", pay_day: "", rent_status: "", start_date: "", end_date: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF({
      room: room?.room ?? "",
      tenant_name: room?.tenant_name ?? "",
      tenant_email: room?.tenant_email ?? "",
      rent: room?.rent ? String(room.rent) : "",
      pay_day: room?.pay_day ? String(room.pay_day) : "",
      rent_status: room?.rent_status ?? "",
      start_date: room?.start_date ?? "",
      end_date: room?.end_date ?? "",
      notes: room?.notes ?? "",
    });
  }, [open, room]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api("PUT", `/api/properties/${propertyId}/rooms`, { ...f, original: room?.room ?? undefined });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!room?.room) return;
    await api("DELETE", `/api/properties/${propertyId}/rooms/${encodeURIComponent(room.room)}`);
    onSaved();
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{room ? `Edit ${room.room || "room"}` : "Add a room"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="r-room">Room</Label><Input id="r-room" placeholder="Room 1" value={f.room} onChange={set("room")} /></div>
              <div><Label htmlFor="r-rent">Rent a month (£)</Label><Input id="r-rent" inputMode="decimal" placeholder="575" value={f.rent} onChange={set("rent")} /></div>
            </div>
            <div><Label htmlFor="r-tenant">Tenant</Label><Input id="r-tenant" placeholder="Name of the person in this room" value={f.tenant_name} onChange={set("tenant_name")} /></div>
            <div><Label htmlFor="r-email">Tenant email (rent invoices)</Label><Input id="r-email" type="email" value={f.tenant_email} onChange={set("tenant_email")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="r-day">Pays on (day)</Label><Input id="r-day" type="number" min={1} max={31} placeholder="1" value={f.pay_day} onChange={set("pay_day")} /></div>
              <div>
                <Label htmlFor="r-status">Status</Label>
                <select id="r-status" className={selectCls} value={f.rent_status} onChange={set("rent_status")}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="r-start">Moved in</Label><Input id="r-start" type="date" value={f.start_date} onChange={set("start_date")} /></div>
              <div><Label htmlFor="r-end">Tenancy ends (blank if rolling)</Label><Input id="r-end" type="date" value={f.end_date} onChange={set("end_date")} /></div>
            </div>
            <div><Label htmlFor="r-notes">Notes</Label><Input id="r-notes" value={f.notes} onChange={set("notes")} /></div>
            <p className="text-xs text-muted-foreground">Saved in the app and kept when the Google Sheet syncs.</p>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter className="mt-2">
            {room?.room && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>Remove room</Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={save} disabled={busy || !f.room.trim()}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${room?.room ?? "this room"}?`}
        description="It disappears from this home, and stays removed after the sheet syncs."
        onConfirm={remove}
      />
    </>
  );
}
