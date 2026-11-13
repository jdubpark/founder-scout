import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Briefcase, Bot, Globe2, Network, Users } from "lucide-react";
import {
  coerceParam,
  paramsFor,
  type DirectiveKind,
  type ParamValue,
  type ScopeLevel,
  type ScopeSelector,
  type SwarmTreeDTO,
} from "@agentswarm/shared";
import { Button } from "../../components/ui/Button";
import { Select, Textarea } from "../../components/ui/Field";
import { Hint, useToast } from "../../components/ui/overlay";
import { SCOPE_NAME } from "../../components/ui/marks";
import { ApiError } from "../../lib/api/http";
import { useCreateDirective } from "../../lib/queries";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { ParamValueInput, draftFor, type ParamDraft } from "./ParamValueInput";
import { agentRefs, buildScope, identityFor, reachOf, scopeFields, targetOptions } from "./scope";

const LEVELS: ScopeLevel[] = ["global", "swarm", "class", "job", "agent"];
const KINDS: DirectiveKind[] = ["rule", "opinion", "context", "param"];

const SCOPE_ICON: Record<ScopeLevel, ReactNode> = {
  global: <Globe2 className="size-4" />,
  swarm: <Network className="size-4" />,
  class: <Users className="size-4" />,
  job: <Briefcase className="size-4" />,
  agent: <Bot className="size-4" />,
};

const TARGET_NAME: Partial<Record<ScopeLevel, string>> = {
  class: "Team",
  job: "Job",
  agent: "Agent",
};

const KIND_LABEL: Record<DirectiveKind, string> = {
  rule: "Rule",
  opinion: "Preference",
  context: "Context",
  param: "Setting",
};

function pill(on: boolean): string {
  return cn(
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm font-bold whitespace-nowrap transition-colors duration-150",
    on ? "border-navy bg-blue-tint text-ink" : "border-rule bg-surface text-ink-2 hover:bg-sunk hover:text-ink",
  );
}

export interface ComposerProps {
  tree: SwarmTreeDTO;
  /** Where the message is aimed at first. Defaults to this swarm. */
  initialScope?: ScopeSelector;
  /** The send button is the page's one primary action only when no other primary is in view. */
  submitVariant?: "primary" | "secondary";
}

/** The message box at the foot of the steering list. Sending it creates one directive. */
export function Composer({ tree, initialScope, submitVariant = "primary" }: ComposerProps) {
  const swarmId = tree.swarm.id;
  const start = scopeFields(initialScope ?? { swarmId });

  const [level, setLevel] = useState<ScopeLevel>(start.level);
  const [chosen, setChosen] = useState(start.target);
  const [kind, setKind] = useState<DirectiveKind>("rule");
  const [text, setText] = useState("");
  const [paramKey, setParamKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ParamDraft>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useCreateDirective();
  const toast = useToast();

  const agents = useMemo(() => agentRefs(tree), [tree]);
  const options = targetOptions(level, tree);
  const target = options.some((o) => o.value === chosen) ? chosen : (options[0]?.value ?? "");
  // Team and job scopes apply in this swarm. Choosing them everywhere is done on the Steering page only.
  const scope = buildScope(level, target, true, swarmId);

  const settingOptions = kind === "param" ? paramsFor(identityFor(level, target, swarmId, agents)) : [];
  const activeDef = settingOptions.find((d) => d.key === paramKey) ?? settingOptions[0] ?? null;
  const draft: ParamDraft = activeDef ? (drafts[activeDef.key] ?? draftFor(activeDef, activeDef.default)) : "";

  const reach = scope ? reachOf(scope, activeDef, tree) : null;
  const reachText = reach ? (reach.wholeSwarmOnce ? "Whole swarm" : plural(reach.names.length, "agent")) : "";

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!scope) {
      setError("Choose where it goes.");
      return;
    }
    let key: string | null = null;
    let value: ParamValue | null = null;
    let body: string | null = null;
    if (kind === "param") {
      if (!activeDef) {
        setError("Choose a setting.");
        return;
      }
      key = activeDef.key;
      const checked = coerceParam(activeDef.key, draft);
      if (!checked.ok) {
        setError(checked.error);
        return;
      }
      value = checked.value;
    } else {
      body = text.trim();
      if (!body) {
        setError("Write something first.");
        return;
      }
    }

    create.mutate(
      { scope, kind, key, value, text: body, note: null, expiresAt: null },
      {
        onSuccess: () => {
          setText("");
          setError(null);
          toast.done(`${KIND_LABEL[kind]} sent`);
        },
        onError: (failure) => {
          const first = failure instanceof ApiError ? Object.values(failure.fields)[0] : undefined;
          setError(first ?? failure.message);
        },
      },
    );
  }

  function sendOnShortcut(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-rule bg-surface p-3" noValidate>
      {kind === "param" ? (
        <div className="flex flex-col gap-3">
          <Select
            aria-label="Setting"
            value={activeDef?.key ?? ""}
            onChange={(e) => {
              setParamKey(e.target.value);
              setError(null);
            }}
          >
            {settingOptions.length === 0 ? <option value="">None here</option> : null}
            {settingOptions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
          {activeDef ? (
            <ParamValueInput
              def={activeDef}
              value={draft}
              onChange={(v) => {
                setDrafts((prev) => ({ ...prev, [activeDef.key]: v }));
                setError(null);
              }}
            />
          ) : null}
        </div>
      ) : (
        <Textarea
          aria-label="Message"
          placeholder="Tell the swarm…"
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={sendOnShortcut}
          className="border-0 bg-transparent px-1 focus-visible:border-transparent"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Applies to" className="flex gap-1">
          {LEVELS.map((l) => (
            <Hint key={l} text={SCOPE_NAME[l]}>
              <button
                type="button"
                role="radio"
                aria-checked={l === level}
                aria-label={SCOPE_NAME[l]}
                onClick={() => {
                  setLevel(l);
                  setChosen("");
                  setError(null);
                }}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md border transition-colors duration-150",
                  l === level ? "border-navy bg-blue-tint text-ink" : "border-rule bg-surface text-ink-2 hover:bg-sunk hover:text-ink",
                )}
              >
                {SCOPE_ICON[l]}
              </button>
            </Hint>
          ))}
        </div>

        {TARGET_NAME[level] && options.length > 0 ? (
          <Select
            aria-label={TARGET_NAME[level]}
            value={target}
            onChange={(e) => {
              setChosen(e.target.value);
              setError(null);
            }}
            className="w-auto max-w-56"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}

        <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
              className={pill(k === kind)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {error ? <span className="text-sm text-red">{error}</span> : reachText ? <span className="text-sm text-ink-2">{reachText}</span> : null}
          <Button type="submit" variant={submitVariant} busy={create.isPending} busyLabel="Sending">
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
