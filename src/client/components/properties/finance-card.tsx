import { useState } from "react";
import { Landmark, Pencil } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate } from "@/lib/utils";
import type { Property } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compactMoney } from "@/components/dashboard/finance-section";

type Draft = { ownership_share: string; market_value: string; mortgage_balance: string; lender: string; lease_end: string; lease_years: string; fixed_rate_end: string };

const toDraft = (p: Property): Draft => ({
  ownership_share: p.ownership_share?.toString() ?? "",
  market_value: p.market_value?.toString() ?? "",
  mortgage_balance: p.mortgage_balance?.toString() ?? "",
  lender: p.lender ?? "",
  lease_end: p.lease_end ?? "",
  lease_years: p.lease_years?.toString() ?? "",
  fixed_rate_end: p.fixed_rate_end ?? "",
});
const num = (v: string) => {
  const n = parseFloat(v.replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Value, mortgage, our share, lease and fixed-rate dates for one home. */
export function FinanceCard({ property: p, onSaved }: { property: Property; onSaved: (p: Property) => void }) {
  const { setError } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(p));
  const [busy, setBusy] = useState(false);

  const share = p.ownership_share && p.ownership_share > 0 ? p.ownership_share / 100 : 1;
  const value = p.market_value ?? 0;
  const debt = p.mortgage_balance ?? 0;
  const equity = value - debt;
  const ltv = value && debt ? debt / value : null;
  const yieldGross = value ? (p.rent_in * 12) / value : null;
  const yearsLeft = p.lease_end ? (Date.parse(p.lease_end) - Date.now()) / (365.25 * 86_400_000) : p.lease_years ?? null;

  async function save() {
    setBusy(true);
    try {
      const body = {
        ownership_share: num(draft.ownership_share),
        market_value: num(draft.market_value),
        mortgage_balance: num(draft.mortgage_balance),
        lender: draft.lender.trim() || null,
        lease_end: draft.lease_end || null,
        lease_years: num(draft.lease_years),
        fixed_rate_end: draft.fixed_rate_end || null,
      };
      const r = await api<{ property: Property }>("PUT", `/api/properties/${p.id}`, body);
      onSaved(r.property);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof Draft, label: string, opts: { type?: string; placeholder?: string } = {}) => (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Input
        type={opts.type ?? "text"}
        inputMode={opts.type ? undefined : k === "lender" ? undefined : "decimal"}
        value={draft[k]}
        placeholder={opts.placeholder}
        autoComplete="off"
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      />
    </div>
  );

  const item = (label: string, value: React.ReactNode, tone?: string) => (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium tabular-nums", tone)}>{value}</dd>
    </div>
  );
  const none = <span className="font-normal text-faint">Not set</span>;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold"><Landmark className="size-4 text-primary" /> Finance</h2>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => { setDraft(toDraft(p)); setEditing(true); }}><Pencil className="size-4" /> Edit</Button>
        )}
      </div>
      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("market_value", "Value (£)", { placeholder: "e.g. 280000" })}
          {field("mortgage_balance", "Mortgage balance (£)")}
          {field("lender", "Lender")}
          {field("ownership_share", "Our share (%)", { placeholder: "100" })}
          {field("fixed_rate_end", "Fixed rate ends", { type: "date" })}
          {field("lease_end", "Lease ends", { type: "date" })}
          {field("lease_years", "Lease years left", { placeholder: "if no end date" })}
          <div className="flex items-end gap-2">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
            Saved here, these stay until someone changes the same cell in the sheet. Fixed-rate dates live only in the app.
          </p>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          {item("Value", value ? compactMoney(value) : none)}
          {item("Mortgage", debt ? `${compactMoney(debt)}${p.lender ? ` · ${p.lender}` : ""}` : p.lender ? p.lender : value ? "None" : none)}
          {item("Loan to value", ltv === null ? "—" : `${Math.round(ltv * 100)}%`, ltv !== null && ltv >= 0.85 ? "text-destructive" : ltv !== null && ltv >= 0.75 ? "text-warning" : undefined)}
          {item("Equity", value ? (share < 1 ? `${compactMoney(equity * share)} ours (${Math.round(share * 100)}%)` : compactMoney(equity)) : "—")}
          {item("Gross yield", yieldGross === null ? "—" : `${(yieldGross * 100).toFixed(1)}%`)}
          {item("Fixed rate ends", p.fixed_rate_end ? formatDate(p.fixed_rate_end) : none)}
          {item(
            "Lease",
            yearsLeft === null ? (p.tenure === "freehold" ? "Freehold" : none) : `${Math.floor(yearsLeft)} years left${p.lease_end ? ` (to ${new Date(p.lease_end).getFullYear()})` : ""}`,
            yearsLeft === null ? undefined : yearsLeft < 50 ? "text-destructive" : yearsLeft < 80 ? "text-warning" : "text-success",
          )}
        </dl>
      )}
    </Card>
  );
}
