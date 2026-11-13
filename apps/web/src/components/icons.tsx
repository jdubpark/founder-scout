/**
 * One icon per thing, used everywhere that thing is named, so a partner learns
 * the picture once. Icons always appear with a short label or an accessible name.
 */
import {
  Banknote,
  Building2,
  BookOpen,
  BookOpenText,
  Eye,
  File,
  FileCode,
  FileSearch,
  Gavel,
  GitBranch,
  GitMerge,
  Globe,
  IdCard,
  Landmark,
  Lightbulb,
  ListFilter,
  Map as MapIcon,
  MessageSquare,
  MessagesSquare,
  Mic,
  Minus,
  Newspaper,
  Package,
  PenLine,
  Phone,
  Radar,
  Rocket,
  Scale,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  User,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ClassId, Decision, DirectiveKind, EvidenceFacet, EvidenceKind, SourceId } from "@agentswarm/shared";
import { cn } from "../lib/cn";
import { StateMark } from "./ui/marks";

const CLASS_ICON: Record<ClassId, LucideIcon> = {
  scout: Radar,
  resolver: GitMerge,
  screener: ListFilter,
  investigator: FileSearch,
  company: Building2,
  verifier: ShieldCheck,
  analyst: Scale,
  outreach: MessagesSquare,
};

const SOURCE_ICON: Record<SourceId, LucideIcon> = {
  hackernews: Newspaper,
  github: GitBranch,
  arxiv: BookOpenText,
  people_data: IdCard,
  web: Globe,
  call: Phone,
  network: Users,
  manual: PenLine,
};

const FACET_ICON: Record<EvidenceFacet, LucideIcon> = {
  mission: Target,
  product: Package,
  traction: TrendingUp,
  funding: Banknote,
  team: Users,
  roadmap: MapIcon,
  market: Globe,
  risk: ShieldAlert,
};

const EVIDENCE_ICON: Record<EvidenceKind, LucideIcon> = {
  profile: User,
  repo: GitBranch,
  code_review: FileCode,
  paper: BookOpenText,
  post: MessageSquare,
  launch: Rocket,
  talk: Mic,
  interview: Mic,
  article: Newspaper,
  funding: Banknote,
  reference: UserCheck,
  call_transcript: Phone,
  filing: Landmark,
  other: File,
};

const KIND_ICON: Record<DirectiveKind, LucideIcon> = {
  rule: Gavel,
  opinion: Lightbulb,
  context: BookOpen,
  param: SlidersHorizontal,
};

const SIZE = "size-4 shrink-0";

export function ClassIcon({ classId, className }: { classId: ClassId; className?: string }) {
  const Icon = CLASS_ICON[classId];
  return <Icon aria-hidden className={cn(SIZE, className)} />;
}

export function SourceIcon({ source, className }: { source: SourceId; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return <Icon aria-hidden className={cn(SIZE, className)} />;
}

export function EvidenceIcon({ kind, className }: { kind: EvidenceKind; className?: string }) {
  const Icon = EVIDENCE_ICON[kind];
  return <Icon aria-hidden className={cn(SIZE, className)} />;
}

export function FacetIcon({ facet, className }: { facet: EvidenceFacet; className?: string }) {
  const Icon = FACET_ICON[facet];
  return <Icon aria-hidden className={cn(SIZE, className)} />;
}

export function KindIcon({ kind, className }: { kind: DirectiveKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden className={cn(SIZE, className)} />;
}

/** Surface is the gold seal, the only place gold appears. */
export function DecisionIcon({ decision, className }: { decision: Decision; className?: string }) {
  if (decision === "surface") return <StateMark state="surfaced" className={cn("size-3.5", className)} />;
  const Icon = decision === "needs_evidence" ? SearchCheck : decision === "watch" ? Eye : Minus;
  return (
    <Icon
      aria-hidden
      className={cn(SIZE, decision === "pass" ? "text-ink-3" : "text-bistre", className)}
    />
  );
}
