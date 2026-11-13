import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Code2, Compass, Cog, Pause, Play, Pin, PinOff, Plus, RotateCcw, UserRound, X } from "lucide-react";
import type { HuntDTO, HuntTrailView, TrailStatus } from "@agentswarm/shared";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/layout";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";
import { useToast } from "../../components/ui/overlay";
import { usd } from "../../lib/format";
import { useUpdateHuntTrail } from "../../lib/queries";
import { AddTrailForm } from "./AddTrailForm";
import { sharePercent, splitTrails } from "./model";

function AttentionGroup({ trail, onSet }: { trail: HuntTrailView; onSet: (weight: number) => void }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={`Attention for ${trail.name}`} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((value) => (
        <label key={value} className="group relative inline-flex size-4 cursor-pointer items-center justify-center rounded-full focus-within:ring-2 focus-within:ring-navy">
          <input className="sr-only" type="radio" name={`${id}-weight`} value={value} checked={trail.weight === value} onChange={() => onSet(value)} aria-label={`${value} of 5`} />
          <span aria-hidden className={`size-2 rounded-full ${value <= trail.weight ? "bg-navy" : "bg-rule-strong"}`} />
        </label>
      ))}
    </div>
  );
}

function TrailRows({ trails, swarmId }: { trails: HuntTrailView[]; swarmId: string }) {
  const update = useUpdateHuntTrail(swarmId);
  const toast = useToast();
  async function patch(trail: HuntTrailView, input: { status?: TrailStatus; pinned?: boolean; weight?: number }) {
    try { await update.mutateAsync({ trailId: trail.id, input }); }
    catch (error) { toast.problem("Trail not updated", error instanceof Error ? error.message : undefined); }
  }
  const opener = { navigator: Compass, person: UserRound, code: Cog } as const;
  return <>
    {trails.map((trail) => {
      const OpenedBy = opener[trail.openedBy];
      return (
        <Tr key={trail.id}>
          <Td className="w-4 pr-0"><span title={trail.status} aria-label={trail.status} className={`inline-block size-2 rounded-full ${trail.status === "open" ? "bg-green-2" : trail.status === "paused" ? "bg-bistre" : "bg-ink-3"}`} /></Td>
          {/* max-w-0 with w-full lets the name take what is left and truncate, so the row never grows wider than its panel. */}
          <Td className="w-full max-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span role="img" aria-label={`Opened by ${trail.openedBy}`} title={`Opened by ${trail.openedBy}`} className="shrink-0"><OpenedBy className="size-4 text-ink-3" aria-hidden /></span>
              <span className="block truncate font-bold text-ink" title={trail.intent}>{trail.name}</span>
              {trail.pinned ? <Pin className="size-3.5 shrink-0 text-navy" role="img" aria-label="Pinned" /> : null}
            </span>
          </Td>
          <Td><AttentionGroup trail={trail} onSet={(weight) => void patch(trail, { weight })} /></Td>
          <Td>
            <div role="meter" aria-label={`${sharePercent(trail.share)} next wave share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(trail.share * 100)} title={`${sharePercent(trail.share)} of the next wave`} className="h-1.5 w-12 rounded-full bg-sunk">
              <div className="h-full rounded-full bg-navy" style={{ width: sharePercent(trail.share) }} />
            </div>
          </Td>
          <Td numeric>{trail.stats.pages}</Td>
          <Td numeric>{trail.stats.leads}</Td>
          <Td numeric>{trail.stats.kept}</Td>
          <Td numeric>{trail.queued}</Td>
          <Td numeric className="whitespace-nowrap">{usd(trail.stats.costUsd)}</Td>
          <Td>
            <div className="flex items-center justify-end gap-0.5">
              <IconButton label={trail.pinned ? "Unpin trail" : "Pin trail"} onClick={() => void patch(trail, { pinned: !trail.pinned })}>{trail.pinned ? <PinOff /> : <Pin />}</IconButton>
              {trail.status === "open" ? <IconButton label="Pause trail" onClick={() => void patch(trail, { status: "paused" })}><Pause /></IconButton> : <IconButton label={trail.status === "closed" ? "Reopen trail" : "Resume trail"} onClick={() => void patch(trail, { status: "open" })}>{trail.status === "closed" ? <RotateCcw /> : <Play />}</IconButton>}
              {trail.status !== "closed" ? <IconButton label="Close trail" disabled={trail.pinned} onClick={() => void patch(trail, { status: "closed" })}><X /></IconButton> : null}
            </div>
          </Td>
        </Tr>
      );
    })}
  </>;
}

export function TrailTable({ hunt }: { hunt: HuntDTO }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const groups = splitTrails(hunt.trails);
  const addButton = <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)} disabled={adding}>Add trail</Button>;
  const all = [...groups.open, ...groups.resting];
  return (
    <section className="min-w-0">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-md font-black text-ink">Trails</h2>
        {all.length ? addButton : null}
      </header>
      {adding ? <AddTrailForm swarmId={hunt.swarmId} engines={hunt.engines} onDone={() => setAdding(false)} /> : null}
      {all.length ? <TableScroll>
        <Table className="text-sm">
          <thead><Tr><Th className="w-4 pr-0"><span className="sr-only">Status</span></Th><Th>Trail</Th><Th>Attention</Th><Th>Share</Th><Th numeric>Pages</Th><Th numeric>Leads</Th><Th numeric>Kept</Th><Th numeric>Waiting</Th><Th numeric>Cost</Th><Th><span className="sr-only">Actions</span></Th></Tr></thead>
          <tbody>
            <TrailRows trails={groups.open} swarmId={hunt.swarmId} />
            {groups.resting.length ? <>
              <Tr><Td colSpan={10} className="py-1"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-sm font-bold text-ink-2 hover:text-ink">{open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}Closed and paused ({groups.resting.length})</button></Td></Tr>
              {open ? <TrailRows trails={groups.resting} swarmId={hunt.swarmId} /> : null}
            </> : null}
          </tbody>
        </Table>
      </TableScroll> : adding ? null : <EmptyState title="No trails yet" action={addButton} />}
    </section>
  );
}
