import { describe, expect, it } from "vitest";
import { createPdlVendor, createRecordAllowance } from "./pdl";
import { FIXED_NOW_MS, jsonResponse, request, scriptedFetch, textResponse } from "./test-support";

const person = {
  id: "pdl-123",
  full_name: "Jane Doe",
  linkedin_url: "http://www.linkedin.com/in/jane-doe",
  job_title: "Co-founder",
  job_company_name: "Acme",
  job_company_website: "acme.example",
  job_start_date: "2026-10",
  job_last_changed: "2026-10-02",
  job_last_verified: "2026-11-01",
  location_name: "San Francisco, California",
  experience: [
    { title: { name: "Co-founder" }, company: { name: "Acme" }, start_date: "2026-10", end_date: null },
    { title: { name: "Engineer" }, company: { name: "Prior Co" }, start_date: "2022-04", end_date: "2026-09" },
    { title: { name: "Intern" }, company: { name: "Earlier Co" }, start_date: "2020", end_date: "2021" },
  ],
  education: [
    { school: { name: "State University" }, degrees: ["B.S."], start_date: "2016", end_date: "2020" },
  ],
};

const makeVendor = (fetch: ReturnType<typeof scriptedFetch>["fetch"]) =>
  createPdlVendor({ apiKey: "secret-test-key", fetchFn: fetch, now: () => new Date(FIXED_NOW_MS) });

describe("People Data Labs adapter", () => {
  it("searches the founder window with only mapped fields and maps results to RawItems", async () => {
    const recorder = scriptedFetch(() => jsonResponse({ data: [person] }));
    const result = await makeVendor(recorder.fetch).fetch(request({ limit: 150, since: "2026-09-29" }));
    const url = new URL(recorder.urls[0]!);
    expect(url.pathname).toBe("/v5/person/search");
    expect(url.searchParams.get("sql")).toContain("job_title LIKE '%founder%'");
    expect(url.searchParams.get("sql")).toContain("job_start_date >= '2026-09'");
    expect(url.searchParams.get("size")).toBe("100");
    const fields = url.searchParams.get("data_include")?.split(",") ?? [];
    expect(fields).toEqual([
      "id", "full_name", "linkedin_url", "job_title", "job_company_name", "job_company_website",
      "job_start_date", "job_last_changed", "job_last_verified", "location_name", "experience", "education",
    ]);
    expect(fields.join(",")).not.toMatch(/birth|phone|email/i);
    expect(url.toString()).not.toContain("secret-test-key");
    expect(recorder.headers[0]!["X-Api-Key"]).toBe("secret-test-key");
    expect(result.items).toEqual([{
      ref: "https://www.linkedin.com/in/jane-doe",
      source: "people_data",
      title: "Jane Doe: Co-founder at Acme",
      text: "Current role: Co-founder at Acme (since 2026-10)\nEngineer at Prior Co (2022-04 to 2026-09)\nIntern at Earlier Co (2020 to 2021)\nState University: B.S.",
      author: "Jane Doe",
      authorUrl: "https://www.linkedin.com/in/jane-doe",
      publishedAt: "2026-10-01T00:00:00.000Z",
      metrics: {},
      simFounderId: null,
    }]);
  });

  it("falls back to a PDL URN and the default 90-day month when needed", async () => {
    const recorder = scriptedFetch(() => jsonResponse({ data: [{ ...person, linkedin_url: null }] }));
    const result = await makeVendor(recorder.fetch).fetch(request({ since: null }));
    const url = new URL(recorder.urls[0]!);
    expect(url.searchParams.get("sql")).toContain("job_start_date >= '2026-08'");
    expect(result.items[0]!.ref).toBe("urn:pdl:person:pdl-123");
    expect(result.items[0]!.authorUrl).toBeNull();
  });

  it("maps enrichment fields and confidence without copying unrequested personal attributes", async () => {
    const sensitive = { ...person, birth_date: "1970-01-01", personal_emails: ["private@example.test"] };
    const recorder = scriptedFetch(() => jsonResponse({ status: 200, likelihood: 8, data: sensitive }));
    const result = await makeVendor(recorder.fetch).enrich({ name: "Jane Doe", company: "Acme" });
    expect(new URL(recorder.urls[0]!).pathname).toBe("/v5/person/enrich");
    expect(new URL(recorder.urls[0]!).searchParams.get("name")).toBe("Jane Doe");
    expect(new URL(recorder.urls[0]!).searchParams.get("company")).toBe("Acme");
    expect(new URL(recorder.urls[0]!).searchParams.get("min_likelihood")).toBe("6");
    expect(result).toEqual({
      vendorId: "pdl-123",
      vendor: "People Data Labs",
      name: "Jane Doe",
      headline: "Co-founder",
      location: "San Francisco, California",
      profileUrl: "https://www.linkedin.com/in/jane-doe",
      current: { title: "Co-founder", company: "Acme", companyUrl: "acme.example", startDate: "2026-10" },
      experience: [
        { title: "Co-founder", company: "Acme", startDate: "2026-10", endDate: null },
        { title: "Engineer", company: "Prior Co", startDate: "2022-04", endDate: "2026-09" },
        { title: "Intern", company: "Earlier Co", startDate: "2020", endDate: "2021" },
      ],
      education: [{ school: "State University", degrees: ["B.S."], startDate: "2016", endDate: "2020" }],
      lastVerifiedAt: "2026-11-01",
      matchConfidence: 0.8,
    });
    expect(JSON.stringify(result)).not.toContain("birth_date");
    expect(JSON.stringify(result)).not.toContain("personal_emails");
    expect(JSON.stringify(result)).not.toContain("private@example.test");
  });

  it("uses the 404 no-match response for enrichment", async () => {
    const recorder = scriptedFetch(() => textResponse("not found", { status: 404 }));
    await expect(makeVendor(recorder.fetch).enrich({ vendorId: "missing" })).resolves.toBeNull();
  });

  it.each([
    [401, /rejected the API key/i],
    [402, /out of credits/i],
  ])("maps HTTP %i to the vendor error", async (status, message) => {
    const recorder = scriptedFetch(() => textResponse("failure", { status }));
    await expect(makeVendor(recorder.fetch).team({ name: "Acme", domain: null }, 1)).rejects.toThrow(message);
  });

  it("does not repeat returned ids and bounds the cursor", async () => {
    const recorder = scriptedFetch(() => jsonResponse({ data: [person] }));
    const vendor = makeVendor(recorder.fetch);
    const first = await vendor.fetch(request());
    const second = await vendor.fetch(request({ cursor: first.cursor }));
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(0);
    expect(second.cursor).toEqual({ seen: ["pdl-123"] });
    const oldIds = Array.from({ length: 2_005 }, (_, index) => `old-${index}`);
    const bounded = await vendor.fetch(request({ limit: 0, cursor: { seen: oldIds } }));
    expect((bounded.cursor as { seen: string[] }).seen).toHaveLength(2_000);
  });

  it("prefers a company domain and safely escapes the company-name fallback", async () => {
    const recorder = scriptedFetch(() => jsonResponse({ data: [person] }));
    const vendor = makeVendor(recorder.fetch);
    await vendor.team({ name: "O'Brien Labs", domain: "Example.COM" }, 40);
    const domainUrl = new URL(recorder.urls[0]!);
    expect(domainUrl.searchParams.get("size")).toBe("25");
    expect(domainUrl.searchParams.get("sql")).toBe("SELECT * FROM person WHERE job_company_website = 'example.com'");
    await vendor.team({ name: "O'Brien Labs", domain: null }, 2);
    expect(new URL(recorder.urls[1]!).searchParams.get("sql")).toBe(
      "SELECT * FROM person WHERE job_company_name = 'o''brien labs'",
    );
    await vendor.team({ name: "Founder' OR '1'='1", domain: null }, 3);
    const injection = new URL(recorder.urls[2]!);
    expect(injection.pathname).toBe("/v5/person/search");
    expect(injection.searchParams.get("sql")).toContain("founder'' or ''1''=''1");
  });

  it("stops asking the vendor for records once the day's allowance is spent, and starts again the next day", async () => {
    let nowMs = FIXED_NOW_MS;
    const allowance = createRecordAllowance(3, () => new Date(nowMs));
    const recorder = scriptedFetch(() => jsonResponse({ data: [person, { ...person, id: "pdl_2" }] }));
    const vendor = createPdlVendor({ apiKey: "secret-test-key", fetchFn: recorder.fetch, now: () => new Date(nowMs), allowance });

    // The scout wants 40 and is given the 3 that are left; the answer held 2, so 1 remains.
    await vendor.fetch(request({ limit: 40 }));
    expect(new URL(recorder.urls[0]!).searchParams.get("size")).toBe("3");
    expect(allowance.left()).toBe(1);

    // A team lookup is cut to what is left, and spends it.
    await vendor.team({ name: "Acme", domain: "acme.example" }, 10);
    expect(new URL(recorder.urls[1]!).searchParams.get("size")).toBe("1");
    expect(allowance.left()).toBe(0);

    // Nothing more is requested today, and the error says how to raise the ceiling.
    await expect(vendor.enrich({ name: "Jane Doe", company: "Acme" })).rejects.toThrow(/allowance of 3 records is used up.*PDL_RECORDS_PER_DAY/);
    expect(recorder.urls).toHaveLength(2);

    nowMs += 24 * 60 * 60 * 1000;
    expect(allowance.left()).toBe(3);
  });

  it("does not count a lookup that found nobody", async () => {
    const allowance = createRecordAllowance(1, () => new Date(FIXED_NOW_MS));
    const recorder = scriptedFetch(() => jsonResponse({ status: 404, error: { type: "not_found" } }, { status: 404 }));
    const vendor = createPdlVendor({ apiKey: "secret-test-key", fetchFn: recorder.fetch, now: () => new Date(FIXED_NOW_MS), allowance });
    expect(await vendor.enrich({ name: "Nobody Here", company: null })).toBeNull();
    expect(allowance.left()).toBe(1);
  });

  it("reserves the last record while parallel enrich calls are in flight", async () => {
    const allowance = createRecordAllowance(1, () => new Date(FIXED_NOW_MS));
    let releaseFetch: () => void = () => { throw new Error("fetch gate was not initialized"); };
    const bothLookupsStarted = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const recorder = scriptedFetch(async () => {
      await bothLookupsStarted;
      return jsonResponse({ status: 200, likelihood: 8, data: person });
    });
    const vendor = createPdlVendor({
      apiKey: "secret-test-key",
      fetchFn: recorder.fetch,
      now: () => new Date(FIXED_NOW_MS),
      allowance,
    });
    let lookupsStarted = 0;
    const startLookup = (name: string) => {
      lookupsStarted++;
      if (lookupsStarted === 2) releaseFetch();
      return vendor.enrich({ name, company: "Acme" });
    };

    const [first, second] = await Promise.allSettled([
      startLookup("Jane Doe"),
      startLookup("John Doe"),
    ]);

    expect(lookupsStarted).toBe(2);
    expect(recorder.urls).toHaveLength(1);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect(second.status === "rejected" ? second.reason.message : "").toMatch(/allowance of 1 records is used up/);
    expect(allowance.left()).toBe(0);
  });

  it("returns reservations when requests fail in each lookup path", async () => {
    const allowance = createRecordAllowance(1, () => new Date(FIXED_NOW_MS));
    const recorder = scriptedFetch(() => { throw new Error("offline test failure"); });
    const vendor = createPdlVendor({
      apiKey: "secret-test-key",
      fetchFn: recorder.fetch,
      now: () => new Date(FIXED_NOW_MS),
      allowance,
    });

    await expect(vendor.fetch(request({ limit: 1 }))).rejects.toThrow(/request failed/);
    expect(allowance.left()).toBe(1);
    await expect(vendor.enrich({ name: "Jane Doe", company: "Acme" })).rejects.toThrow(/request failed/);
    expect(allowance.left()).toBe(1);
    await expect(vendor.team({ name: "Acme", domain: null }, 1)).rejects.toThrow(/request failed/);
    expect(allowance.left()).toBe(1);
  });

});
