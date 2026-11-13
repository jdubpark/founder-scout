import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Swarm } from "@agentswarm/shared";
import { useSwarms } from "./queries";

const KEY = "agentswarm.swarm";

interface SwarmContextValue {
  swarms: Swarm[];
  /** The swarm every page is showing. null while loading or when none exists. */
  swarm: Swarm | null;
  swarmId: string | null;
  select: (id: string) => void;
  loading: boolean;
  error: Error | null;
}

const SwarmContext = createContext<SwarmContextValue | null>(null);

function remembered(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function SwarmProvider({ children }: { children: ReactNode }) {
  const query = useSwarms();
  const [chosen, setChosen] = useState<string | null>(remembered);

  const select = useCallback((id: string) => {
    setChosen(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      // Not being able to remember the choice is harmless.
    }
  }, []);

  const value = useMemo<SwarmContextValue>(() => {
    const swarms = query.data ?? [];
    const swarm = swarms.find((s) => s.id === chosen) ?? swarms[0] ?? null;
    return {
      swarms,
      swarm,
      swarmId: swarm?.id ?? null,
      select,
      loading: query.isLoading,
      error: query.error,
    };
  }, [query.data, query.isLoading, query.error, chosen, select]);

  return <SwarmContext.Provider value={value}>{children}</SwarmContext.Provider>;
}

export function useSwarm(): SwarmContextValue {
  const value = useContext(SwarmContext);
  if (!value) throw new Error("useSwarm must be used inside SwarmProvider");
  return value;
}
