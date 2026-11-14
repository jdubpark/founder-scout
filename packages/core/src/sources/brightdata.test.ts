import { describe, expect, it } from "vitest";
import { createBrightDataVendor } from "./brightdata";
import { createRecordAllowance } from "./pdl";
import type { FetchFn } from "./http";
import { FIXED_NOW_MS, jsonResponse, scriptedFetch } from "./test-support";

const profile = {
  id: "bd-profile-1",
  name: "Jane Doe",
  city: "San Francisco",
  country_code: "us",
  position: "Co-founder at Acme",
  about: "Builds developer tools.",
  url: "https://www.linkedin.com/in/jane-doe/",
  experience: [
    { title: "Co-founder", company: "Acme", start_date: "Oct 2026", end_date: "Present" },
    { title: "Engineer", company: "Prior Co", start_date: "2022-04", end_date: "2026-09" },
  ],
  education: [
    { title: "State University", degree: "B.S.", start_date: "2016", end_date: "2020" },
  ],
  last_updated: "2026-11-01",
};

const searchResult = {
  id: "bd-search-1",
  url: "https://www.linkedin.com/in/jane-doe",
  name: "Jane Doe",
  subtitle: "Co-founder at Acme",
  location: "San Francisco, California",
  experience: [
    { title: "Co-founder", company: "Acme", start_date: "2026-10", end_date: "Present" },
  ],
  education: [
    { title: "State University", degree: "B.S." },
  ],
};

type Route = (url: URL) => Response | Promise<Response>;

function snapshotRoute(records: unknown[], statuses: string[] = ["running", "ready"]): Route {
  let poll = 0;
  return (url) => {
    if (url.pathname === "/datasets/v3/trigger") return jsonResponse({ snapshot_id: "snap-1" });
    if (url.pathname === "/datasets/v3/progress/snap-1") {
      const status = statuses[poll] ?? "ready";
      poll += 1;
      return jsonResponse({ status });
    }
    if (url.pathname === "/datasets/v3/snapshot/snap-1") return jsonResponse(records);
    throw new Error(`unexpected URL ${url.toString()}`);
  };
}

function makeVendor(route: Route, overrides: { allowance?: ReturnType<typeof createRecordAllowance> } = {}) {
  const recorder = scriptedFetch(route);
  const bodies: string[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    return recorder.fetch(url, init);
  };
  const vendor = createBrightDataVendor({
    apiKey: "secret-test-key",
    allowance: overrides.allowance ?? createRecordAllowance(5, () => new Date(FIXED_NOW_MS)),
    fetchFn,
    now: () => FIXED_NOW_MS,
    sleep: async () => undefined,
  });
  return { vendor, recorder, bodies };
}

describe("Bright Data LinkedIn Scraper adapter", () => {
  it("triggers, polls, downloads and maps a direct profile lookup", async () => {
    const { vendor, recorder, bodies } = makeVendor(snapshotRoute([profile]));

    const result = await vendor.enrich({ profileUrl: "https://www.linkedin.com/in/jane-doe/" });

    expect(new URL(recorder.urls[0]!).pathname).toBe("/datasets/v3/trigger");
    const trigger = new URL(recorder.urls[0]!);
    expect(trigger.searchParams.get("dataset_id")).toBe("gd_l1viktl72bvl7bjuj0");
    expect(trigger.searchParams.get("format")).toBe("json");
    expect(recorder.headers[0]!["Authorization"]).toBe("Bearer secret-test-key");
    expect(JSON.parse(bodies[0]!)).toEqual([{ url: "https://www.linkedin.com/in/jane-doe/" }]);
    expect(recorder.urls.slice(1).map((raw) => new URL(raw).pathname)).toEqual([
      "/datasets/v3/progress/snap-1",
      "/datasets/v3/progress/snap-1",
      "/datasets/v3/snapshot/snap-1",
    ]);
    expect(new URL(recorder.urls[3]!).searchParams.get("format")).toBe("json");

    expect(result).toEqual({
      vendorId: "bd-profile-1",
      vendor: "Bright Data",
      name: "Jane Doe",
      headline: "Co-founder at Acme",
      location: "San Francisco, US",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      current: { title: "Co-founder", company: "Acme", companyUrl: null, startDate: "2026-10" },
      experience: [
        { title: "Co-founder", company: "Acme", startDate: "2026-10", endDate: null },
        { title: "Engineer", company: "Prior Co", startDate: "2022-04", endDate: "2026-09" },
      ],
      education: [{ school: "State University", degrees: ["B.S."], startDate: "2016", endDate: "2020" }],
      lastVerifiedAt: "2026-11-01",
      matchConfidence: 1,
    });
    expect(recorder.urls.every((raw) => new URL(raw).host === "api.brightdata.com")).toBe(true);
  });

  it("searches by name with the search dataset and maps the first result as an unconfident match", async () => {
    const { vendor, recorder, bodies } = makeVendor(snapshotRoute([searchResult]));

    const result = await vendor.enrich({ name: "Jane Doe", company: "Acme" });

    const trigger = new URL(recorder.urls[0]!);
    expect(trigger.searchParams.get("dataset_id")).toBe("gd_m8d03he47z8nwb5xc");
    expect(JSON.parse(bodies[0]!)).toEqual([
      { url: "https://www.linkedin.com", first_name: "Jane", last_name: "Doe" },
    ]);
    expect(result).toEqual({
      vendorId: "bd-search-1",
      vendor: "Bright Data",
      name: "Jane Doe",
      headline: "Co-founder at Acme",
      location: "San Francisco, California",
      profileUrl: "https://www.linkedin.com/in/jane-doe",
      current: { title: "Co-founder", company: "Acme", companyUrl: null, startDate: "2026-10" },
      experience: [{ title: "Co-founder", company: "Acme", startDate: "2026-10", endDate: null }],
      education: [{ school: "State University", degrees: ["B.S."], startDate: null, endDate: null }],
      lastVerifiedAt: null,
      matchConfidence: null,
    });
  });

  it("does not request anything for a non-professional-network profile address", async () => {
    const { vendor, recorder } = makeVendor(() => {
      throw new Error("unexpected request");
    });

    expect(await vendor.enrich({ profileUrl: "https://example.com/in/jane-doe" })).toBeNull();
    expect(recorder.urls).toHaveLength(0);
  });

  it("returns null when the snapshot is empty", async () => {
    const allowance = createRecordAllowance(5, () => new Date(FIXED_NOW_MS));
    const { vendor, recorder } = makeVendor(snapshotRoute([]), { allowance });

    expect(await vendor.enrich({ profileUrl: "https://www.linkedin.com/in/jane-doe/" })).toBeNull();
    expect(recorder.urls).toHaveLength(4);
    expect(allowance.left()).toBe(5);
  });

  it("stops once the day's allowance is spent", async () => {
    const allowance = createRecordAllowance(1, () => new Date(FIXED_NOW_MS));
    const { vendor, recorder } = makeVendor(snapshotRoute([profile]), { allowance });

    await expect(vendor.enrich({ profileUrl: "https://www.linkedin.com/in/jane-doe/" })).resolves.not.toBeNull();
    expect(allowance.left()).toBe(0);
    expect(recorder.urls).toHaveLength(4);

    await expect(vendor.enrich({ profileUrl: "https://www.linkedin.com/in/jane-doe/" })).resolves.toBeNull();
    expect(recorder.urls).toHaveLength(4);
  });

  it("reports readiness without making a request", async () => {
    const { vendor, recorder } = makeVendor(() => {
      throw new Error("unexpected request");
    });

    const status = await vendor.status();

    expect(status.configured).toBe(true);
    expect(status.detail).toContain("LinkedIn Scraper API");
    expect(status.detail).not.toContain("secret-test-key");
    expect(recorder.urls).toHaveLength(0);
  });

  it("returns no team because the datasets expose only an employee count", async () => {
    const { vendor, recorder } = makeVendor(() => {
      throw new Error("unexpected request");
    });

    expect(await vendor.team({ name: "Acme", domain: null }, 10)).toEqual([]);
    expect(recorder.urls).toHaveLength(0);
  });
});
