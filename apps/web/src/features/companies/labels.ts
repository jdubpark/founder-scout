import type { CompanyDimensionGroup, CompanySort, CompanyStatus } from "@agentswarm/shared";
import type { MarkState } from "../../components/ui/marks";

/** The words, mark and chip tone for each company status. */
export const COMPANY_STATUS_VIEW: Record<
  CompanyStatus,
  { label: string; mark: MarkState; tone: "neutral" | "green" | "gold" | "red" | "bistre" }
> = {
  tracked: { label: "Tracked", mark: "idle", tone: "neutral" },
  surfaced: { label: "Surfaced", mark: "surfaced", tone: "gold" },
  needs_evidence: { label: "Needs evidence", mark: "warn", tone: "bistre" },
  watch: { label: "Watching", mark: "warn", tone: "bistre" },
  passed: { label: "Passed", mark: "idle", tone: "neutral" },
  archived: { label: "Archived", mark: "paused", tone: "neutral" },
};

export const COMPANY_SORT_OPTIONS: ReadonlyArray<{ value: CompanySort; label: string }> = [
  { value: "deal", label: "Overall" },
  { value: "company", label: "Company" },
  { value: "team", label: "Founders" },
  { value: "recent", label: "Recent" },
];

export const COMPANY_GROUP_LABEL: Record<CompanyDimensionGroup, string> = {
  problem: "Problem",
  product: "Product",
  progress: "Progress",
  team: "Team",
  risk: "Risk",
};

/** Two letters from a name, as an avatar shows them. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Month and year in UTC, so a date never shifts a month in a partner's time zone. */
export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
