import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { EmptyState, SkeletonRows } from "./components/ui/layout";

const Overview = lazy(() => import("./pages/Overview"));
const Founders = lazy(() => import("./pages/Founders"));
const FounderDetail = lazy(() => import("./pages/FounderDetail"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));
const Swarm = lazy(() => import("./pages/Swarm"));
const Steering = lazy(() => import("./pages/Steering"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Improve = lazy(() => import("./pages/Improve"));
const Activity = lazy(() => import("./pages/Activity"));
const RunDetail = lazy(() => import("./pages/RunDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const Kit = lazy(() => import("./pages/Kit"));

const page = (node: ReactNode) => <Suspense fallback={<SkeletonRows rows={6} />}>{node}</Suspense>;

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: page(<Overview />) },
      { path: "founders", element: page(<Founders />) },
      { path: "founders/:founderId", element: page(<FounderDetail />) },
      { path: "companies", element: page(<Companies />) },
      { path: "companies/:companyId", element: page(<CompanyDetail />) },
      { path: "swarm", element: page(<Swarm />) },
      { path: "steering", element: page(<Steering />) },
      { path: "approvals", element: page(<Approvals />) },
      { path: "improve", element: page(<Improve />) },
      { path: "improve/:flowId", element: page(<Improve />) },
      { path: "activity", element: page(<Activity />) },
      { path: "activity/:runId", element: page(<RunDetail />) },
      { path: "settings", element: page(<Settings />) },
      // Not in the menu: a gallery of the shared visuals on live data.
      { path: "kit", element: page(<Kit />) },
      {
        path: "*",
        element: <EmptyState title="There is no page at this address">Choose a page from the menu.</EmptyState>,
      },
    ],
  },
];
