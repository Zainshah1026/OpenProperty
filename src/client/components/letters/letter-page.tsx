import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Bold, Check, ExternalLink, FileText, Heading2, Italic, List, Pencil, Printer, Trash2, Underline, Upload, X,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, toIsoDate } from "@/lib/utils";
import type { Letter, LetterStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/page-shell";
import type { DocumentRow } from "@/components/compliance/documents";
import { CATEGORY_LABEL, LETTER_CSS, earliestCourtDate, longDate, templateById } from "./templates";
import { STATUS_LABEL, StatusBadge } from "./letter-bits";
import { LegalNote, Paper } from "./new-letter-dialog";
import { sanitizeHtml } from "./sanitize";

export function LetterPage({ id, navigate }: { id: number; navigate: (to: string) => void }) {
  const { setError } = useApp();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [files, setFiles] = useState<DocumentRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [missing, setMissing] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ letter: Letter }>("GET", `/api/letters/${id}`);
      setLetter(r.letter);
      const d = await api<{ documents: DocumentRow[] }>("GET", `/api/documents?letter_id=${id}`).catch(() => ({ documents: [] }));
      setFiles(d.documents);
    } catch (err) {
      if (/not found/i.test((err as Error).message)) setMissing(true);
      else setError((err as Error).message);
    }
  }, [id, setError]);
  useEffect(() => { load(); }, [load]);

  async function update(patch: Partial<Letter>) {
    setBusy(true);
    try {
      const r = await api<{ letter: Letter }>("PUT", `/api/letters/${id}`, patch);
      setLetter((l) => (l ? { ...l, ...r.letter, body: patch.body ?? l.body } : l));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveText() {
    const html = sanitizeHtml(docRef.current?.innerHTML ?? "");
    await update({ body: html });
    setEditing(false);
  }

  function setStatus(s: LetterStatus) {
    const today = toIsoDate(new Date());
    update({
      status: s,
      ...(s === "sent" && !letter?.sent_on ? { sent_on: today } : {}),
      ...(s === "signed" && !letter?.signed_on ? { signed_on: today } : {}),
    });
  }

  async function upload(file: File) {
    if (!letter?.property_id) return setError("Link this to a property first.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("property_id", String(letter.property_id));
      fd.append("kind", letter.category === "arrears" ? "notice" : "agreement");
      fd.append("label", `${letter.title} (signed copy)`);
      fd.append("letter_id", String(letter.id));
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
      if (letter.status === "draft" || (letter.status === "sent" && letter.category !== "arrears")) {
        await update(letter.category === "arrears" ? { status: "sent", sent_on: letter.sent_on ?? toIsoDate(new Date()) } : { status: "signed", signed_on: letter.signed_on ?? toIsoDate(new Date()) });
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(docId: number) {
    try {
      await api("DELETE", `/api/documents/${docId}`);
      setFiles((f) => f.filter((x) => x.id !== docId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    try {
      for (const f of files) await api("DELETE", `/api/documents/${f.id}`);
      await api("DELETE", `/api/letters/${id}`);
      navigate("/letters");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function print() {
    const html = editing ? sanitizeHtml(docRef.current?.innerHTML ?? "") : sanitizeHtml(letter?.body ?? "");
    const w = window.open("", "_blank");
    if (!w) return setError("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${(letter?.title ?? "Letter").replace(/[<>&]/g, "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">
<style>${LETTER_CSS}
@page { size: A4; margin: 18mm 18mm 20mm; }
body { margin: 0; background: #fff; }
.letter-doc .pagebreak { border: 0; margin: 0; }
@media screen { body { background: #e9edf1; } .letter-doc { background: #fff; max-width: 760px; margin: 24px auto; padding: 56px 64px; box-shadow: 0 2px 16px rgba(0,0,0,.12); } }
</style></head><body><div class="letter-doc">${html}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  }

  if (missing) {
    return (
      <PageShell title="Not found">
        <p className="text-sm text-muted-foreground">This letter has been deleted. <button className="text-primary underline" onClick={() => navigate("/letters")}>Back to Letters & contracts</button></p>
      </PageShell>
    );
  }
  if (!letter) return <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>;

  const tpl = templateById(letter.template);
  const isUpload = letter.template === "upload";
  const fields = (letter.fields ?? {}) as Record<string, string>;

  return (
    <PageShell
      title={letter.title}
      meta={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={letter.status} />
          <span>{CATEGORY_LABEL[letter.category]}</span>
          {letter.property_id && (
            <>· <button className="hover:text-foreground hover:underline" onClick={() => navigate(`/properties/${letter.property_id}`)}>{letter.property_ref ? `${letter.property_ref} · ` : ""}{letter.property_name}</button></>
          )}
          {letter.tenant_id && letter.tenant_name && (
            <>· <button className="hover:text-foreground hover:underline" onClick={() => navigate(`/tenants/${letter.tenant_id}`)}>{letter.tenant_name}</button></>
          )}
        </span>
      }
      width="max-w-[1400px]"
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate("/letters")} className="hidden md:inline-flex"><ArrowLeft /> All letters</Button>
          {!isUpload && !editing && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit text</Button>}
          {!isUpload && <Button onClick={print}><Printer /> Print / PDF</Button>}
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {editing && (
            <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-1 rounded-xl bg-card p-1.5 shadow-raised">
              <ToolBtn label="Bold" cmd="bold"><Bold /></ToolBtn>
              <ToolBtn label="Italic" cmd="italic"><Italic /></ToolBtn>
              <ToolBtn label="Underline" cmd="underline"><Underline /></ToolBtn>
              <ToolBtn label="Heading" cmd="formatBlock" arg="h2"><Heading2 /></ToolBtn>
              <ToolBtn label="Bullet list" cmd="insertUnorderedList"><List /></ToolBtn>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); load(); }}><X /> Cancel</Button>
                <Button size="sm" onClick={saveText} disabled={busy}><Check /> {busy ? "Saving…" : "Save changes"}</Button>
              </span>
            </div>
          )}
          {isUpload ? (
            files[0] ? (
              /\.pdf$/i.test(files[0].filename) || files[0].content_type === "application/pdf" ? (
                <iframe title={letter.title} src={`/api/documents/${files[0].id}/file`} className="h-[80vh] w-full rounded-xl bg-white shadow-card" />
              ) : /^image\//.test(files[0].content_type) ? (
                <img src={`/api/documents/${files[0].id}/file`} alt={letter.title} className="mx-auto max-h-[80vh] rounded-xl shadow-card" />
              ) : (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  <FileText className="mx-auto mb-2 size-7" />
                  <a className="text-primary underline" href={`/api/documents/${files[0].id}/file?download=1`}>Download {files[0].filename}</a>
                </Card>
              )
            ) : (
              <Card className="p-8 text-center text-sm text-muted-foreground">No file attached yet. Upload it on the right.</Card>
            )
          ) : (
            <div className="rounded-2xl bg-muted/60 p-3 md:p-6">
              <Paper key={editing ? "edit" : "view"} html={sanitizeHtml(letter.body ?? "")} editable={editing} innerRef={docRef} />
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Status</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {(["draft", "sent", "signed", "void"] as LetterStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => setStatus(s)}
                  className={cn("rounded-lg px-3 py-2 text-sm font-medium transition", letter.status === s ? "bg-primary text-primary-foreground" : "shadow-edge hover:bg-muted")}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <label className="text-muted-foreground">Sent / served
                <Input type="date" className="mt-1" value={letter.sent_on ?? ""} onChange={(e) => update({ sent_on: e.target.value || null })} />
              </label>
              <label className="text-muted-foreground">Signed
                <Input type="date" className="mt-1" value={letter.signed_on ?? ""} onChange={(e) => update({ signed_on: e.target.value || null })} />
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Created {formatDate(letter.created_at)}{letter.created_by ? ` by ${letter.created_by}` : ""}. Last changed {formatDate(letter.updated_at)}.</p>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{isUpload ? "File" : "Signed copies"}</h2>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload /> Upload</Button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }}
              />
            </div>
            {files.length === 0 ? (
              <p className="text-xs text-muted-foreground">{isUpload ? "No file yet." : "Once it's signed or served, scan or photograph it and upload it here so the signed version is kept with the property."}</p>
            ) : (
              <ul className="divide-y text-sm">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 py-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <a href={`/api/documents/${f.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.filename}</a>
                    <a href={`/api/documents/${f.id}/file`} target="_blank" rel="noreferrer" aria-label="Open"><ExternalLink className="size-4 text-muted-foreground" /></a>
                    <button type="button" aria-label="Delete file" onClick={() => removeFile(f.id)}><Trash2 className="size-4 text-muted-foreground hover:text-destructive" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {tpl && <NextSteps template={tpl.id} fields={fields} />}

          <Button variant="destructive" className="w-full" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
          <LegalNote />
        </aside>
      </div>
      <ConfirmDelete
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete "${letter.title}"?`}
        description={files.length ? `Its ${files.length} uploaded file${files.length === 1 ? "" : "s"} will be deleted too.` : undefined}
        onConfirm={remove}
      />
    </PageShell>
  );
}

function ToolBtn({ label, cmd, arg, children }: { label: string; cmd: string; arg?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd, false, arg); }}
      className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** What to do after creating each kind of document. */
function NextSteps({ template, fields }: { template: string; fields: Record<string, string> }) {
  const steps: string[] =
    template === "section8-cover"
      ? [
          "Download the current Form 3A from GOV.UK and fill it in from the checklist page.",
          "Serve the form with this covering letter on every joint tenant.",
          "Keep proof of how and when it was served (photo, recorded-delivery receipt).",
          `Court proceedings can't start before ${longDate(earliestCourtDate(fields.served_on || toIsoDate(new Date()), (fields.grounds || "").split(",").filter(Boolean)))}.`,
          "Mark this as Sent and upload the served copy.",
        ]
      : template === "apt-agreement"
        ? [
            "Print two copies (or save as PDF for e-signing) and have every tenant sign.",
            "Protect the deposit within 30 days and give the prescribed information.",
            "Give the gas safety record, EPC and electrical report before they move in.",
            "Upload the signed copy here and mark it Signed.",
          ]
        : template === "company-let-agreement"
          ? [
              "Check the company on Companies House and that the signatory is a director.",
              "Have it signed for the company and upload the signed copy.",
              "Ask the company for the names of everyone who will live there.",
            ]
          : template === "company-notice"
            ? ["Serve it at the company's registered office and at the property.", "Keep proof of service, then mark as Sent."]
            : ["Send or hand it to the tenant, then mark it Sent.", "Note any reply or payment plan on the property."];
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Next steps</h2>
      <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </Card>
  );
}
