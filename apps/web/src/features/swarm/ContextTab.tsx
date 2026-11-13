import { useState } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { type ClassId, type JobId, type SwarmTreeDTO } from "@agentswarm/shared";
import { ClassIcon } from "../../components/icons";
import { Chip } from "../../components/ui/marks";
import { Table, Td, Th, Tr } from "../../components/ui/table";
import { Hint } from "../../components/ui/overlay";
import { CARRIER_LABEL, contextGrid, crossingLines, poolLabel, poolsForJob } from "./contextGrid";

/** The whole swarm's context: which pools each class of agent reads, and how text crosses between pools. */
export function ContextTab({ tree }: { tree: SwarmTreeDTO }) {
  const classIds = tree.classes.map((c) => c.cls.id as ClassId);
  const labels = new Map(tree.classes.map((c) => [c.cls.id as ClassId, c.cls.label]));
  const rows = contextGrid(classIds);
  const lines = crossingLines();

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Pool</Th>
              {classIds.map((id) => (
                <Th key={id} className="text-center">
                  <span className="inline-flex flex-col items-center gap-1 text-sm font-bold text-ink-2">
                    <ClassIcon classId={id} />
                    <span className="whitespace-nowrap">{labels.get(id) ?? id}</span>
                  </span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pool, cells }) => (
              <Tr key={pool.id}>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <Hint text={`${pool.holds} Per: ${pool.per}.`}>
                      <button type="button" className="text-left text-base font-bold text-ink hover:underline">
                        {pool.label}
                      </button>
                    </Hint>
                    {pool.sealed ? (
                      <span role="img" aria-label="Sealed" title="Sealed" className="inline-flex text-ink-3">
                        <Lock className="size-3.5" aria-hidden />
                      </span>
                    ) : null}
                  </span>
                </Td>
                {cells.map((cell) => (
                  <Td key={cell.classId} className="text-center">
                    {cell.filled ? (
                      <span
                        role="img"
                        aria-label={`${labels.get(cell.classId) ?? cell.classId} read ${pool.label}`}
                        className="inline-block size-2.5 rounded-full bg-navy"
                      />
                    ) : null}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>

      <section className="flex flex-col gap-1">
        <h3 className="m-0 text-sm font-bold text-ink-3">Crossings</h3>
        <ol className="m-0 flex list-none flex-col p-0">
          {lines.map((line) => (
            <Crossing key={`${line.from}>${line.to}:${line.form}`} line={line} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Crossing({ line }: { line: ReturnType<typeof crossingLines>[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-rule last:border-b-0">
      <Hint text={line.rule}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-w-0 items-center gap-2.5 py-2.5 text-left hover:bg-sunk"
        >
          <span className="shrink-0 text-base font-bold text-ink">{line.fromLabel}</span>
          <ArrowRight className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="shrink-0 text-base font-bold text-ink">{line.toLabel}</span>
          <span className="shrink-0 rounded-full border border-rule px-2 text-xs font-bold text-ink-3">
            {CARRIER_LABEL[line.by]}
          </span>
          <span className="min-w-0 truncate text-sm text-ink-2" title={line.form}>
            {line.form}
          </span>
        </button>
      </Hint>
      {open ? <p className="m-0 pb-3 text-sm text-ink-2">{line.rule}</p> : null}
    </li>
  );
}

/** The pools a selected job reads, as chips. Renders nothing for a job that reads none. */
export function ReadsLine({ jobId }: { jobId: JobId }) {
  const pools = poolsForJob(jobId);
  if (pools.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-ink-2">Reads</span>
      {pools.map((id) => (
        <Chip key={id}>{poolLabel(id)}</Chip>
      ))}
    </div>
  );
}
