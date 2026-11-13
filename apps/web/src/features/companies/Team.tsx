import { Link } from "react-router-dom";
import type { CompanyMember, FounderRow, NetworkContact } from "@agentswarm/shared";
import { SourceIcon } from "../../components/icons";
import { Avatar, Panel } from "../../components/ui/layout";
import { sourceLabel } from "../founders/labels";

interface Person {
  key: string;
  name: string;
  role: string | null;
  founderId: string | null;
}

/** The people on the team, then the partners' contacts who work here. */
export function TeamPanel({
  members,
  founders,
  knownPeople,
}: {
  members: CompanyMember[];
  founders: FounderRow[];
  knownPeople: NetworkContact[];
}) {
  // The listed team is the source. Until it is read, the followed founders stand in for it.
  const people: Person[] =
    members.length > 0
      ? members.map((m) => ({ key: m.id, name: m.name, role: m.role, founderId: m.founderId }))
      : founders.map((f) => ({ key: f.id, name: f.name, role: "Founder", founderId: f.id }));

  if (people.length === 0 && knownPeople.length === 0) return null;

  return (
    <Panel title={people.length > 0 ? "Team" : undefined}>
      <div className="flex flex-col gap-6">
        {people.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-4 p-0">
            {people.map((p) => (
              <li key={p.key} className="flex min-w-0 items-center gap-3">
                <Avatar name={p.name} />
                <div className="min-w-0">
                  {p.founderId ? (
                    <Link
                      to={`/founders/${encodeURIComponent(p.founderId)}`}
                      className="block max-w-64 truncate font-bold text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <p className="max-w-64 truncate font-bold text-ink">{p.name}</p>
                  )}
                  {p.role ? <p className="max-w-64 truncate text-sm text-ink-2">{p.role}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {knownPeople.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-ink-3">You know</h3>
            <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-4 p-0">
              {knownPeople.map((k) => (
                <li key={k.id} className="flex min-w-0 items-center gap-3">
                  <span role="img" aria-label={sourceLabel("network")} title={sourceLabel("network")} className="shrink-0">
                    <SourceIcon source="network" className="size-4 text-navy" />
                  </span>
                  <div className="min-w-0">
                    <p className="max-w-64 truncate font-bold text-ink">{k.name}</p>
                    {k.position ? <p className="max-w-64 truncate text-sm text-ink-2">{k.position}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
