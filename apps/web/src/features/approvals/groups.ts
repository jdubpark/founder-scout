import { Mail, Phone, UserCheck, type LucideIcon } from "lucide-react";
import type { OutreachKind, OutreachRow, OutreachStatus } from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";

export type GroupId = "waiting" | "approved" | "done" | "rejected";

/** The four tabs. Failed and cancelled items sit under Done, with their own word. */
export const GROUPS: ReadonlyArray<{ id: GroupId; label: string; statuses: readonly OutreachStatus[] }> = [
  { id: "waiting", label: "Waiting", statuses: ["proposed"] },
  { id: "approved", label: "Approved", statuses: ["approved"] },
  { id: "done", label: "Done", statuses: ["dispatched", "completed", "failed", "cancelled"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
];

export function isGroupId(value: string | null): value is GroupId {
  return GROUPS.some((g) => g.id === value);
}

export function groupRows(rows: readonly OutreachRow[], id: GroupId): OutreachRow[] {
  const statuses = GROUPS.find((g) => g.id === id)?.statuses ?? [];
  return rows.filter((r) => statuses.includes(r.status));
}

export const KIND_VIEW: Record<OutreachKind, { label: string; icon: LucideIcon }> = {
  email_founder: { label: "Email to founder", icon: Mail },
  call_founder: { label: "Founder call", icon: Phone },
  call_reference: { label: "Reference call", icon: UserCheck },
};

export const STATUS_VIEW: Record<OutreachStatus, { label: string; mark: MarkState }> = {
  proposed: { label: "Waiting", mark: "idle" },
  approved: { label: "Approved", mark: "ok" },
  rejected: { label: "Rejected", mark: "paused" },
  dispatched: { label: "Sent", mark: "ok" },
  completed: { label: "Done", mark: "ok" },
  failed: { label: "Failed", mark: "error" },
  cancelled: { label: "Cancelled", mark: "paused" },
};

export function isCall(kind: OutreachKind): boolean {
  return kind !== "email_founder";
}
