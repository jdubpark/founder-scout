import { useState } from "react";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import type { EvalFlowDTO, EvalVariant } from "@agentswarm/shared";
import { Button, IconButton } from "../../components/ui/Button";
import { Status } from "../../components/ui/marks";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";
import { Hint, useToast } from "../../components/ui/overlay";
import { usd } from "../../lib/format";
import { usePromoteVariant } from "../../lib/queries";
import { canUseVariant, changeLabel, decisionReason, inUseVariant, roundLabel, score, statusView } from "./variants";

/** Every round with its score, cost and status. A round that was not reverted and is not in use gets "Use this". */
export function RoundsTable({ flow, swarmId, swarmConfigId }: { flow: EvalFlowDTO; swarmId: string; swarmConfigId: string | null }) {
  const head = flow.headlineMetric;
  const inUse = inUseVariant(flow, swarmConfigId);
  // Cost has its own column, from the round's recorded cost.
  const others = flow.metrics.filter((m) => m.id !== head && m.id !== "cost_usd");
  const [confirming, setConfirming] = useState<string | null>(null);
  const promote = usePromoteVariant();
  const toast = useToast();

  const use = (v: EvalVariant) =>
    promote.mutate(
      { id: flow.id, input: { variant: v.id, swarmId } },
      {
        onSuccess: () => {
          setConfirming(null);
          toast.done(`${roundLabel(v)} is in use`);
        },
        onError: (e) => toast.problem("The configuration was not changed", e.message),
      },
    );

  const headMetric = flow.metrics.find((m) => m.id === head);

  return (
    <TableScroll className="relative">
      <Table className="min-w-[48rem]">
        <thead>
          <tr>
            <Th>Round</Th>
            <Th>Change</Th>
            <Th numeric>
              <span className="inline-flex items-center gap-1">
                {headMetric?.label ?? head}
                {headMetric?.better === "lower" ? <ArrowDown className="size-3" aria-label="lower is better" /> : <ArrowUp className="size-3" aria-label="higher is better" />}
              </span>
            </Th>
            {others.map((m) => (
              <Th key={m.id} numeric>
                <span className="inline-flex items-center gap-1">
                  {m.label}
                  {m.better === "lower" ? <ArrowDown className="size-3" aria-label="lower is better" /> : <ArrowUp className="size-3" aria-label="higher is better" />}
                </span>
              </Th>
            ))}
            <Th numeric>Cost</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Action</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {flow.variants.map((v) => {
            const isInUse = v.id === inUse;
            const status = statusView(v, isInUse);
            const canUse = canUseVariant(v, isInUse);
            return (
              <Tr key={v.id} selected={isInUse}>
                <Td className="whitespace-nowrap font-semibold text-ink">{roundLabel(v)}</Td>
                <Td className="min-w-56 whitespace-normal text-ink">{changeLabel(v)}</Td>
                <Td numeric>{score(v.test[head])}</Td>
                {others.map((m) => (
                  <Td key={m.id} numeric>
                    {score(v.test[m.id])}
                  </Td>
                ))}
                <Td numeric>{usd(v.costUsd)}</Td>
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <Status state={status.mark}>{status.label}</Status>
                    {decisionReason(v) ? (
                      <Hint text={decisionReason(v) ?? ""}>
                        <IconButton label="Why">
                          <Info />
                        </IconButton>
                      </Hint>
                    ) : null}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">
                  {canUse && confirming !== v.id ? (
                    <Button size="sm" onClick={() => setConfirming(v.id)}>
                      Use this
                    </Button>
                  ) : null}
                  {canUse && confirming === v.id ? (
                    <span className="inline-flex gap-2">
                      <Button size="sm" onClick={() => use(v)} busy={promote.isPending} busyLabel="Saving">
                        Confirm
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setConfirming(null)} disabled={promote.isPending}>
                        Cancel
                      </Button>
                    </span>
                  ) : null}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
