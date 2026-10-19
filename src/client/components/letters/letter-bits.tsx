import { Building, FileSignature, Gavel, type LucideIcon } from "lucide-react";
import type { LetterStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import type { Category } from "./templates";

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  arrears: Gavel,
  tenancy: FileSignature,
  company: Building,
};

export const STATUS_LABEL: Record<LetterStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  void: "Cancelled",
};

export function StatusBadge({ status }: { status: LetterStatus }) {
  const v = status === "signed" ? "success" : status === "sent" ? "info" : status === "void" ? "neutral" : "warning";
  return <Badge variant={v}>{STATUS_LABEL[status]}</Badge>;
}
