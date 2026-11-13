import type { SeparationStat } from "@agentswarm/shared";
import { BAR_WIDTH, barGeometry, barLabel, barX } from "./model";

const HEIGHT = 14;
const MID = HEIGHT / 2;

/**
 * One evidence bar: a track from 0 to 100%, a tick at chance, the 95% band and a dot at the
 * value. An empty track when there is no value, and a hollow dot when the cases are too few to
 * judge. Drawn with theme tokens so it reads in the page.
 */
export function EvidenceBar({ name, stat }: { name: string; stat: SeparationStat | null | undefined }) {
  const { value, band, thin } = barGeometry(stat);
  return (
    <svg width={BAR_WIDTH} height={HEIGHT} viewBox={`0 0 ${BAR_WIDTH} ${HEIGHT}`} role="img" aria-label={barLabel(name, stat)} className="shrink-0">
      <line x1={0} x2={BAR_WIDTH} y1={MID} y2={MID} stroke="var(--color-rule-strong)" strokeWidth={4} strokeLinecap="round" />
      <line x1={barX(0.5)} x2={barX(0.5)} y1={0} y2={HEIGHT} stroke="var(--color-ink-3)" strokeWidth={1} />
      {band ? (
        <line
          x1={barX(band[0])}
          x2={barX(band[1])}
          y1={MID}
          y2={MID}
          stroke="var(--color-navy)"
          strokeOpacity={0.35}
          strokeWidth={4}
          strokeLinecap="round"
        />
      ) : null}
      {value !== null ? (
        thin
          ? <circle cx={barX(value)} cy={MID} r={3} fill="var(--color-ground)" stroke="var(--color-ink-3)" strokeWidth={1.25} />
          : <circle cx={barX(value)} cy={MID} r={3.5} fill="var(--color-ink)" />
      ) : null}
    </svg>
  );
}
