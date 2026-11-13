import { describe, expect, it } from "vitest";
import { claudeFetchDenyRules, isNeverFetchHost, isNeverFetchUrl, NEVER_FETCH_HOSTS } from "./policy";

describe("never-fetch hosts", () => {
  it("covers the host, its subdomains, and odd spellings, and nothing that merely looks similar", () => {
    for (const host of ["linkedin.com", "www.linkedin.com", "uk.linkedin.com", "LinkedIn.com.", "media.licdn.com", "lnkd.in"]) {
      expect(isNeverFetchHost(host), host).toBe(true);
    }
    for (const host of ["notlinkedin.com", "linkedin.com.example.org", "example.com", "linkedin.co"]) {
      expect(isNeverFetchHost(host), host).toBe(false);
    }
    expect(isNeverFetchUrl("https://www.linkedin.com/in/someone")).toBe(true);
    expect(isNeverFetchUrl("https://example.com/?next=https://www.linkedin.com/in/someone")).toBe(false);
    expect(isNeverFetchUrl("not an address")).toBe(false);
  });

  it("gives the research agent a bare rule and a wildcard rule for every host", () => {
    const rules = claudeFetchDenyRules();
    for (const host of NEVER_FETCH_HOSTS) {
      expect(rules).toContain(`WebFetch(domain:${host})`);
      expect(rules).toContain(`WebFetch(domain:*.${host})`);
    }
  });
});
