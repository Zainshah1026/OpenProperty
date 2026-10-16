import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkOrderDialog } from "./work-order-dialog";
import type { WorkOrder, WorkOrderStatus } from "@/types";
import { PageShell } from "@/components/page-shell";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-destructive-tint text-destructive",
  high: "bg-warning-tint text-warning",
  normal: "bg-info-tint text-info",
  low: "bg-muted text-muted-foreground",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "secondary",
  assigned: "default",
  in_progress: "default",
  completed: "outline",
  cancelled: "outline",
};

export function MaintenancePage() {
  const app = useApp();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WorkOrderStatus | "open_all" | "all">("open_all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | undefined>(undefined);

  async function load() {
    try {
      setLoading(true);
      const list = await app.listWorkOrders();
      setOrders(list);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /** Tick a job off (or un-tick it) straight from its card. */
  async function toggleDone(w: WorkOrder) {
    const done = w.status === "completed";
    const patch = done
      ? { title: w.title, status: "open" as WorkOrderStatus, completed_at: null }
      : { title: w.title, status: "completed" as WorkOrderStatus, completed_at: new Date().toISOString().slice(0, 10) };
    setOrders((list) => list.map((x) => (x.id === w.id ? { ...x, ...patch } : x)));
    try {
      await app.updateWorkOrder(w.id, patch);
    } catch (err) {
      app.setError((err as Error).message);
      load();
    }
  }

  const counts = useMemo(() => {
    const c = { all: orders.length, open: 0, assigned: 0, in_progress: 0, completed: 0, urgent: 0 };
    for (const o of orders) {
      if (o.status === "open") c.open++;
      if (o.status === "assigned") c.assigned++;
      if (o.status === "in_progress") c.in_progress++;
      if (o.status === "completed") c.completed++;
      if (o.priority === "urgent" && o.status !== "completed" && o.status !== "cancelled") c.urgent++;
    }
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "open_all") return orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  return (
    <PageShell
      title="Maintenance"
      meta={<>
          {counts.open + counts.assigned + counts.in_progress} open
          {counts.urgent > 0 && (
            <span className="badge-tone tone-danger ml-2">
              <CircleAlert className="h-3 w-3" /> {counts.urgent} urgent
            </span>
          )}
        </>}
      actions={
        filtered.length > 0 ? (
          <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New work order
          </Button>
        ) : null
      }
    >

        <Tabs value={filter} onValueChange={(v) => setFilter(v as never)}>
          <TabsList>
            <TabsTrigger value="open_all">Open</TabsTrigger>
            <TabsTrigger value="open">Unassigned</TabsTrigger>
            <TabsTrigger value="assigned">Assigned</TabsTrigger>
            <TabsTrigger value="in_progress">In progress</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
            <Wrench className="size-7 text-faint" aria-hidden />
            <p className="font-medium">Nothing here</p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              {orders.length === 0 ? "Track repairs and turnover work for your properties." : "No work orders match this filter."}
            </p>
            {orders.length === 0 && (
              <Button className="mt-2" onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> New work order
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((w) => (
              <Card
                key={w.id}
                className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted"
                onClick={() => { setEditing(w); setDialogOpen(true); }}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleDone(w); }}
                    aria-label={w.status === "completed" ? "Mark as not done" : "Mark as done"}
                    title={w.status === "completed" ? "Mark as not done" : "Mark as done"}
                    className={cn(
                      "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      w.status === "completed" ? "border-success-solid bg-success-solid text-white" : "border-input text-transparent hover:border-success-solid hover:text-success-solid",
                    )}
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className={cn("truncate font-semibold", w.status === "completed" && "text-muted-foreground line-through")}>{w.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[w.property_name, w.unit_name].filter(Boolean).join(" · ") || "Unassigned"}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", PRIORITY_TONE[w.priority])}>
                    {w.priority === "urgent" && <CircleAlert className="mr-1 h-3 w-3" />}
                    {w.priority}
                  </span>
                </div>
                {w.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{w.description}</p>
                )}
                {w.source === "tenant" && (
                  <p className="mt-2 text-xs">
                    <span className="badge-tone tone-info">Reported by tenant</span>{" "}
                    <span className="text-muted-foreground">{[w.reported_by, w.reporter_contact].filter(Boolean).join(", ")}</span>
                  </p>
                )}
                {w.source === "tenant" && w.notes && (
                  <p className="mt-1 text-xs text-muted-foreground">{w.notes}</p>
                )}
                {w.photo_ids && (
                  <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {w.photo_ids.split(",").slice(0, 4).map((id) => (
                      <a key={id} href={`/api/documents/${id}/file`} target="_blank" rel="noreferrer" className="block size-16 overflow-hidden rounded-lg bg-muted">
                        <img src={`/api/documents/${id}/file`} alt="Photo sent with the report" className="size-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"} className="capitalize">{w.status.replace("_", " ")}</Badge>
                    {w.vendor_name && <span className="text-muted-foreground">{w.vendor_name}</span>}
                  </div>
                  <div className="text-right text-muted-foreground">
                    {w.scheduled_at && <div>Scheduled {formatDate(w.scheduled_at)}</div>}
                    {w.cost != null && <div className="font-medium tabular-nums text-foreground">{formatMoney(w.cost, app.settings.currency)}</div>}
                    {!w.scheduled_at && w.cost == null && <div>Created {formatDate(w.created_at)}</div>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

      <WorkOrderDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) load(); }}
        workOrder={editing}
      />
    </PageShell>
  );
}
