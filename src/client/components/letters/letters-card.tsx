import { useEffect, useState } from "react";
import { FilePlus2, FileSignature } from "lucide-react";
import { api } from "@/api";
import type { Letter } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LetterList } from "./letters-page";
import { NewLetterDialog } from "./new-letter-dialog";

/** Letters & contracts for one property or one tenant. */
export function LettersCard({ propertyId, tenantId, navigate }: { propertyId?: number; tenantId?: number; navigate: (to: string) => void }) {
  const [rows, setRows] = useState<Letter[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = propertyId ? `property_id=${propertyId}` : `tenant_id=${tenantId}`;
    api<{ letters: Letter[] }>("GET", `/api/letters?${q}`).then((r) => setRows(r.letters)).catch(() => setRows([]));
  }, [propertyId, tenantId]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold leading-tight"><FileSignature className="size-4 text-primary" /> Letters &amp; contracts</h2>
        <Button size="sm" onClick={() => setOpen(true)}><FilePlus2 /> New</Button>
      </div>
      {rows === null ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No tenancy agreements, notices or letters yet. Create one from a template, or upload a signed agreement you already have.
        </Card>
      ) : (
        <LetterList rows={rows} navigate={navigate} compact={!!propertyId} />
      )}
      <NewLetterDialog open={open} onOpenChange={setOpen} propertyId={propertyId ?? null} tenantId={tenantId ?? null} onCreated={(l) => navigate(`/letters/${l.id}`)} />
    </section>
  );
}
