import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createMemoryRouter, RouterProvider } from "react-router-dom";
import type { DemoSnapshot } from "@agentswarm/shared";
import { ApiProvider } from "./lib/api/context";
import { SwarmProvider } from "./lib/swarm";
import { ToastProvider, TooltipProvider } from "./components/ui/overlay";
import { routes } from "./routes";

declare const __DEMO__: boolean;

/**
 * The demo build runs on a snapshot. A generated one (written by
 * `pnpm swarm demo-snapshot`) is used when present, otherwise the small
 * hand-built sample.
 */
async function loadSnapshot(): Promise<DemoSnapshot | undefined> {
  if (!__DEMO__) return undefined;
  const generated = import.meta.glob<{ default: DemoSnapshot }>("./lib/api/demo-snapshot.json");
  const load = Object.values(generated)[0];
  return load ? (await load()).default : undefined;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } },
});

// The demo keeps its route in memory, because a page embedded in a frame cannot rely on its address.
const router = __DEMO__ ? createMemoryRouter(routes) : createBrowserRouter(routes);

const snapshot = await loadSnapshot();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider snapshot={snapshot}>
        <TooltipProvider>
          <ToastProvider>
            <SwarmProvider>
              <RouterProvider router={router} />
            </SwarmProvider>
          </ToastProvider>
        </TooltipProvider>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
