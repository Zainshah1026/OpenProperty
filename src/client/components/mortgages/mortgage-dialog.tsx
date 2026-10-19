import { useEffect, useState } from "react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Mortgage, MortgageCharge, RateType, RepaymentType } from "@/types";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHARGE_LABEL, RATE_LABEL, REPAYMENT_LABEL } from "./mortgage-math";
import { MortgageDocuments } from "./mortgage-documents";

type Draft = {
  property_id: string;
  lender: string;
  account_ref: string;
  borrower: string;
  broker: string;
  charge: MortgageCharge;
  repayment_type: RepaymentType;
  rate_type: RateType;
  interest_rate: string;
  deal_end: string;
  follow_on_rate: string;
  start_date: string;
  term_end: string;
  balance: string;
  balance_as_of: string;
  monthly_payment: string;
  payment_day: string;
  erc_until: string;
  erc_note: string;
  status: "active" | "redeemed";
  notes: string;
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function toDraft(m: Mortgage | null, propertyId?: number | null): Draft {
  return {
    property_id: s(m?.property_id ?? propertyId),
    lender: s(m?.lender),
    account_ref: s(m?.account_ref),
    borrower: s(m?.borrower),
    broker: s(m?.broker),
    charge: m?.charge ?? "first",
    repayment_type: m?.repayment_type ?? "interest_only",
    rate_type: m?.rate_type ?? "fixed",
    interest_rate: s(m?.interest_rate),
    deal_end: s(m?.deal_end),
    follow_on_rate: s(m?.follow_on_rate),
    start_date: s(m?.start_date),
    term_end: s(m?.term_end),
    balance: s(m?.balance),
    balance_as_of: s(m?.balance_as_of),
    monthly_payment: s(m?.monthly_payment),
    payment_day: s(m?.payment_day),
    erc_until: s(m?.erc_until),
    erc_note: s(m?.erc_note),
    status: m?.status ?? "active",
    notes: s(m?.notes),
  };
}

const num = (v: string) => {
  const n = parseFloat(v.replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const orNull = (v: string) => v.trim() || null;

const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

/**
 * Add or edit one mortgage. `mortgage` undefined = closed, null = new.
 * A new one can be pinned to a home with `propertyId`.
 */
export function MortgageDialog({
  mortgage,
  propertyId,
  onClose,
}: {
  mortgage: Mortgage | null | undefined;
  propertyId?: number | null;
  onClose: (changed: boolean) => void;
}) {
  const { properties } = useApp();
  const open = mortgage !== undefined;
  const [d, setD] = useState<Draft>(toDraft(null, propertyId));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [docsChanged, setDocsChanged] = useState(false);

  useEffect(() => {
    if (!open) return;
    setD(toDraft(mortgage ?? null, propertyId));
    setMsg(null);
    setDocsChanged(false);
  }, [open, mortgage, propertyId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const homes = properties
    .filter((p) => p.section !== "managed" || String(p.id) === d.property_id)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function save() {
    if (!d.lender.trim()) return setMsg("Add the lender's name.");
    const rate = num(d.interest_rate);
    if (rate !== null && rate > 25) return setMsg("The interest rate looks too high: enter it as a percentage, for example 5.24.");
    const day = num(d.payment_day);
    if (day !== null && (day < 1 || day > 31 || !Number.isInteger(day))) return setMsg("The payment day should be a day of the month, 1 to 31.");
    const body = {
      property_id: d.property_id ? Number(d.property_id) : null,
      lender: d.lender.trim(),
      account_ref: orNull(d.account_ref),
      borrower: orNull(d.borrower),
      broker: orNull(d.broker),
      charge: d.charge,
      repayment_type: d.repayment_type,
      rate_type: d.rate_type,
      interest_rate: rate,
      deal_end: d.deal_end || null,
      follow_on_rate: num(d.follow_on_rate),
      start_date: d.start_date || null,
      term_end: d.term_end || null,
      balance: num(d.balance),
      balance_as_of: d.balance_as_of || null,
      monthly_payment: num(d.monthly_payment),
      payment_day: day,
      erc_until: d.erc_until || null,
      erc_note: orNull(d.erc_note),
      status: d.status,
      notes: orNull(d.notes),
    };
    setBusy(true);
    setMsg(null);
    try {
      if (mortgage) await api("PUT", `/api/mortgages/${mortgage.id}`, body);
      else await api("POST", "/api/mortgages", body);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api("DELETE", `/api/mortgages/${mortgage!.id}`);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const text = (k: keyof Draft, label: string, opts: { placeholder?: string; money?: boolean; type?: string } = {}) => (
    <div>
      <Label className="mb-1 block" htmlFor={`mg-${k}`}>{label}</Label>
      <Input
        id={`mg-${k}`}
        type={opts.type ?? "text"}
        inputMode={opts.money ? "decimal" : undefined}
        value={d[k] as string}
        placeholder={opts.placeholder}
        autoComplete="off"
        onChange={(e) => set(k, e.target.value as never)}
      />
    </div>
  );
  const date = (k: keyof Draft, label: string) => text(k, label, { type: "date" });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(docsChanged); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{mortgage ? `Edit ${mortgage.lender} mortgage` : "Add a mortgage"}</DialogTitle></DialogHeader>

          <div className="grid gap-5">
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="section-label mb-2">The loan</legend>
              <div className="sm:col-span-2">
                <Label className="mb-1 block" htmlFor="mg-property">Property</Label>
                <select id="mg-property" className={selectCls} value={d.property_id} onChange={(e) => set("property_id", e.target.value)}>
                  <option value="">Not linked to a home</option>
                  {homes.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
                </select>
              </div>
              {text("lender", "Lender", { placeholder: "e.g. Paragon" })}
              {text("account_ref", "Account number")}
              {text("borrower", "In the name of", { placeholder: "e.g. Chisti & Co Ltd" })}
              {text("broker", "Broker")}
              <div>
                <Label className="mb-1 block" htmlFor="mg-charge">Type of loan</Label>
                <select id="mg-charge" className={selectCls} value={d.charge} onChange={(e) => set("charge", e.target.value as MortgageCharge)}>
                  {(Object.keys(CHARGE_LABEL) as MortgageCharge[]).map((k) => <option key={k} value={k}>{CHARGE_LABEL[k]}</option>)}
                </select>
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="mg-repay">Repayment</Label>
                <select id="mg-repay" className={selectCls} value={d.repayment_type} onChange={(e) => set("repayment_type", e.target.value as RepaymentType)}>
                  {(Object.keys(REPAYMENT_LABEL) as RepaymentType[]).map((k) => <option key={k} value={k}>{REPAYMENT_LABEL[k]}</option>)}
                </select>
              </div>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="section-label mb-2">Rate and deal</legend>
              <div>
                <Label className="mb-1 block" htmlFor="mg-ratetype">Rate type</Label>
                <select id="mg-ratetype" className={selectCls} value={d.rate_type} onChange={(e) => set("rate_type", e.target.value as RateType)}>
                  {(Object.keys(RATE_LABEL) as RateType[]).map((k) => <option key={k} value={k}>{RATE_LABEL[k]}</option>)}
                </select>
              </div>
              {text("interest_rate", "Interest rate now (%)", { money: true, placeholder: "e.g. 5.24" })}
              {date("deal_end", "Deal ends")}
              {text("follow_on_rate", "Rate after the deal (%)", { money: true, placeholder: "Lender's SVR, e.g. 8.49" })}
              {date("erc_until", "Early repayment charges until")}
              {text("erc_note", "Early repayment charge", { placeholder: "e.g. 3% of balance" })}
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="section-label mb-2">Balance and payments</legend>
              {text("balance", "Balance outstanding (£)", { money: true })}
              {date("balance_as_of", "Balance as of")}
              {text("monthly_payment", "Monthly payment (£)", { money: true, placeholder: "Leave blank to estimate" })}
              {text("payment_day", "Payment day of month", { money: true, placeholder: "e.g. 1" })}
              {date("start_date", "Loan started")}
              {date("term_end", "Term ends (must be repaid by)")}
            </fieldset>

            <div>
              <Label className="mb-1 block" htmlFor="mg-notes">Notes</Label>
              <Textarea id="mg-notes" rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>

            {mortgage ? (
              <MortgageDocuments mortgageId={mortgage.id} propertyId={mortgage.property_id} onChanged={() => setDocsChanged(true)} />
            ) : (
              <p className="text-sm text-muted-foreground">You can add statements and the mortgage offer once the mortgage is saved.</p>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={d.status === "redeemed"} onChange={(e) => set("status", e.target.checked ? "redeemed" : "active")} />
              This loan has been paid off or replaced
            </label>

            {msg && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{msg}</p>}
          </div>

          <DialogFooter className="mt-2">
            {mortgage && <Button variant="destructive" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button variant="ghost" onClick={() => onClose(docsChanged)}>{docsChanged ? "Close" : "Cancel"}</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : mortgage ? "Save" : "Add mortgage"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {mortgage && (
        <ConfirmDelete
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete the ${mortgage.lender} mortgage?`}
          description="To keep a record of a loan you've paid off, tick 'paid off' instead. Deleting can't be undone."
          onConfirm={remove}
        />
      )}
    </>
  );
}
