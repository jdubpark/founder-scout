/**
 * Every read and write the pages make. Pages call these hooks and never touch
 * the API client or query keys directly, so caching and refresh rules live in
 * one place.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AddAgentInput,
  AddFounderInput,
  CompanyFeedbackInput,
  CompanyQuery,
  CreateDirectiveInput,
  CreateSwarmInput,
  DirectiveFilter,
  EffectiveSteeringQuery,
  FeedbackInput,
  FounderQuery,
  NetworkImportInput,
  OutreachCompleteInput,
  OutreachDecisionInput,
  OutreachQuery,
  PromoteVariantInput,
  RunEvalRoundInput,
  SettingsPatch,
  StartRunInput,
  UpdateAgentInput,
  UpdateDirectiveInput,
  UpdateSwarmInput,
} from "@agentswarm/shared";
import { useApi } from "./api/context";

const IDLE_REFRESH = 20_000;
const ACTIVE_REFRESH = 3_000;

export const keys = {
  settings: ["settings"] as const,
  swarms: ["swarms"] as const,
  overview: (swarmId: string) => ["overview", swarmId] as const,
  tree: (swarmId: string) => ["tree", swarmId] as const,
  directives: (filter: DirectiveFilter) => ["directives", filter] as const,
  effective: (query: EffectiveSteeringQuery) => ["effective", query] as const,
  suggestions: (swarmId: string) => ["suggestions", swarmId] as const,
  founders: (query: FounderQuery) => ["founders", query] as const,
  founder: (id: string) => ["founder", id] as const,
  companies: (query: CompanyQuery) => ["companies", query] as const,
  company: (id: string) => ["company", id] as const,
  network: ["network"] as const,
  outreach: (query: OutreachQuery) => ["outreach", query] as const,
  runs: (swarmId: string) => ["runs", swarmId] as const,
  run: (id: string) => ["run", id] as const,
  task: (id: string) => ["task", id] as const,
  evals: ["evals"] as const,
  evalFlow: (id: string) => ["eval", id] as const,
};

/** After steering changes, everything that shows steering or its effects is stale. */
function steeringChanged(qc: QueryClient) {
  for (const root of ["directives", "effective", "tree", "overview", "suggestions"]) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

function runsChanged(qc: QueryClient) {
  for (const root of ["runs", "run", "overview", "tree", "founders", "founder", "outreach"]) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

/* ------------------------------- Reads ----------------------------- */

export function useSettings() {
  const { client } = useApi();
  return useQuery({ queryKey: keys.settings, queryFn: () => client.getSettings(), refetchInterval: 60_000 });
}

export function useSwarms() {
  const { client } = useApi();
  return useQuery({ queryKey: keys.swarms, queryFn: () => client.listSwarms() });
}

export function useOverview(swarmId: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.overview(swarmId ?? ""),
    queryFn: () => client.getOverview(swarmId as string),
    enabled: Boolean(swarmId),
    refetchInterval: (query) => (query.state.data?.activeRun ? ACTIVE_REFRESH : IDLE_REFRESH),
  });
}

export function useTree(swarmId: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.tree(swarmId ?? ""),
    queryFn: () => client.getTree(swarmId as string),
    enabled: Boolean(swarmId),
    refetchInterval: IDLE_REFRESH,
  });
}

export function useDirectives(filter: DirectiveFilter, enabled = true) {
  const { client } = useApi();
  return useQuery({ queryKey: keys.directives(filter), queryFn: () => client.listDirectives(filter), enabled });
}

export function useEffectiveSteering(query: EffectiveSteeringQuery | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.effective(query ?? { swarmId: "" }),
    queryFn: () => client.getEffectiveSteering(query as EffectiveSteeringQuery),
    enabled: Boolean(query?.swarmId),
  });
}

/** Steering proposed from patterns in the partners' yes and no calls. */
export function useSuggestions(swarmId: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.suggestions(swarmId ?? ""),
    queryFn: () => client.listSuggestions(swarmId as string),
    enabled: Boolean(swarmId),
  });
}

export function useFounders(query: FounderQuery | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.founders(query ?? { swarmId: "" }),
    queryFn: () => client.listFounders(query as FounderQuery),
    enabled: Boolean(query?.swarmId),
    placeholderData: (previous) => previous,
    refetchInterval: IDLE_REFRESH,
  });
}

export function useFounder(id: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.founder(id ?? ""),
    queryFn: () => client.getFounder(id as string),
    enabled: Boolean(id),
  });
}

export function useCompanies(query: CompanyQuery | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.companies(query ?? { swarmId: "" }),
    queryFn: () => client.listCompanies(query as CompanyQuery),
    enabled: Boolean(query?.swarmId),
    placeholderData: (previous) => previous,
    refetchInterval: IDLE_REFRESH,
  });
}

export function useCompany(id: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.company(id ?? ""),
    queryFn: () => client.getCompany(id as string),
    enabled: Boolean(id),
  });
}

export function useNetwork() {
  const { client } = useApi();
  return useQuery({ queryKey: keys.network, queryFn: () => client.getNetwork() });
}

export function useOutreach(query: OutreachQuery | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.outreach(query ?? { swarmId: "" }),
    queryFn: () => client.listOutreach(query as OutreachQuery),
    enabled: Boolean(query?.swarmId),
    refetchInterval: IDLE_REFRESH,
  });
}

export function useRuns(swarmId: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.runs(swarmId ?? ""),
    queryFn: () => client.listRuns(swarmId as string, 30),
    enabled: Boolean(swarmId),
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "running" || r.status === "queued") ? ACTIVE_REFRESH : IDLE_REFRESH,
  });
}

export function useRun(id: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.run(id ?? ""),
    queryFn: () => client.getRun(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "running" || status === "queued" ? ACTIVE_REFRESH : false;
    },
  });
}

export function useTask(id: string | null) {
  const { client } = useApi();
  return useQuery({ queryKey: keys.task(id ?? ""), queryFn: () => client.getTask(id as string), enabled: Boolean(id) });
}

export function useEvalFlows() {
  const { client } = useApi();
  return useQuery({ queryKey: keys.evals, queryFn: () => client.listEvalFlows() });
}

export function useEvalFlow(id: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: keys.evalFlow(id ?? ""),
    queryFn: () => client.getEvalFlow(id as string),
    enabled: Boolean(id),
  });
}

/* ------------------------------- Writes ---------------------------- */

export function useUpdateSettings() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => client.updateSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useCreateSwarm() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSwarmInput) => client.createSwarm(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.swarms }),
  });
}

export function useUpdateSwarm() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: UpdateSwarmInput }) => client.updateSwarm(args.id, args.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.swarms });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["tree"] });
    },
  });
}

export function useAddAgent() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { swarmId: string; input: AddAgentInput }) => client.addAgent(args.swarmId, args.input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export function useUpdateAgent() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { agentId: string; patch: UpdateAgentInput }) => client.updateAgent(args.agentId, args.patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export function useCreateDirective() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDirectiveInput) => client.createDirective(input),
    onSuccess: () => steeringChanged(qc),
  });
}

export function useUpdateDirective() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: UpdateDirectiveInput }) => client.updateDirective(args.id, args.patch),
    onSuccess: () => steeringChanged(qc),
  });
}

export function useDismissSuggestion() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { swarmId: string; key: string }) => client.dismissSuggestion(args.swarmId, args.key),
    onSuccess: (data, args) => qc.setQueryData(keys.suggestions(args.swarmId), data),
  });
}

/** Records a partner's yes or no on a candidate, with reasons. */
export function useAddFeedback() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { founderId: string; input: FeedbackInput }) => client.addFeedback(args.founderId, args.input),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: keys.founder(args.founderId) });
      void qc.invalidateQueries({ queryKey: ["founders"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      void qc.invalidateQueries({ queryKey: ["effective"] });
    },
  });
}

/** Records a partner's yes or no on a company, with reasons. */
export function useAddCompanyFeedback() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { companyId: string; input: CompanyFeedbackInput }) =>
      client.addCompanyFeedback(args.companyId, args.input),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: ["companies"] });
      void qc.invalidateQueries({ queryKey: keys.company(args.companyId) });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

/** A person adds a founder by hand. */
export function useAddFounder() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFounderInput) => client.addFounder(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["founders"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

/** Uploading a contact list changes who is known, so companies and founders are stale. */
function networkChanged(qc: QueryClient) {
  for (const root of ["network", "companies", "company", "founders", "founder"]) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

export function useImportNetwork() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NetworkImportInput) => client.importNetwork(input),
    onSuccess: () => networkChanged(qc),
  });
}

export function useRemoveNetwork() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (owner: string) => client.removeNetwork(owner),
    onSuccess: () => networkChanged(qc),
  });
}

export function useDecideOutreach() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: OutreachDecisionInput }) => client.decideOutreach(args.id, args.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["outreach"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["founder"] });
    },
  });
}

export function useCompleteOutreach() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: OutreachCompleteInput }) => client.completeOutreach(args.id, args.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["outreach"] });
      void qc.invalidateQueries({ queryKey: ["founder"] });
    },
  });
}

export function useStartRun() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartRunInput) => client.startRun(input),
    onSuccess: () => runsChanged(qc),
  });
}

export function useCancelRun() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.cancelRun(id),
    onSuccess: () => runsChanged(qc),
  });
}

export function useRunEvalRounds() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input?: RunEvalRoundInput }) => client.runEvalRounds(args.id, args.input),
    onSuccess: (data) => {
      qc.setQueryData(keys.evalFlow(data.id), data);
      void qc.invalidateQueries({ queryKey: keys.evals });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function usePromoteVariant() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; input: PromoteVariantInput }) => client.promoteEvalVariant(args.id, args.input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eval"] });
      void qc.invalidateQueries({ queryKey: keys.evals });
      void qc.invalidateQueries({ queryKey: ["tree"] });
      void qc.invalidateQueries({ queryKey: keys.swarms });
    },
  });
}
