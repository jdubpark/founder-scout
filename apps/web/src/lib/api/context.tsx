import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ApiClient, DemoSnapshot } from "@agentswarm/shared";
import { createDemoClient } from "./demo";
import { createHttpClient } from "./http";
import { SAMPLE_SNAPSHOT } from "./sample-snapshot";

declare const __DEMO__: boolean;

const ACTOR_KEY = "agentswarm.actor";

/** The name recorded against steering and approvals. Kept in this browser only. */
export function getActor(): string {
  try {
    return window.localStorage.getItem(ACTOR_KEY)?.trim() || "Partner";
  } catch {
    return "Partner";
  }
}

export function setActor(name: string): void {
  try {
    window.localStorage.setItem(ACTOR_KEY, name.trim());
  } catch {
    // Storage can be unavailable in private windows. The default name is used.
  }
}

interface ApiContextValue {
  client: ApiClient;
  /** True when the page is running on a frozen snapshot instead of a server. */
  demo: boolean;
  /** The caution shown on every page in demo mode. */
  demoNote: string | null;
}

const ApiContext = createContext<ApiContextValue | null>(null);

/**
 * Chooses the data source once. The demo build, and any page opened with
 * `?demo`, runs on a snapshot of simulated data and never calls a server.
 */
export function ApiProvider({ children, snapshot }: { children: ReactNode; snapshot?: DemoSnapshot }) {
  const value = useMemo<ApiContextValue>(() => {
    const forced = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
    const demo = __DEMO__ || forced || snapshot !== undefined;
    if (demo) {
      const data = snapshot ?? SAMPLE_SNAPSHOT;
      return { client: createDemoClient(data, getActor), demo: true, demoNote: data.note };
    }
    return { client: createHttpClient({ getActor }), demo: false, demoNote: null };
  }, [snapshot]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error("useApi must be used inside ApiProvider");
  return value;
}
