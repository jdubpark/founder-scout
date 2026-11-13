import { describe, expect, it } from "vitest";
import { claudeFetchDenyRules, isNeverFetchHost, isNeverFetchUrl, isOffLimitsHost, NEVER_FETCH_HOSTS, termsBar, TERMS_BARRED_HOSTS } from "./policy";

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

describe("sites whose terms bar automated reading", () => {
  it("covers the site and its subdomains, with a reason a person can read", () => {
    expect(termsBar("devpost.com")?.why).toContain("automated");
    expect(termsBar("someone.Substack.com.")?.host).toBe("substack.com");
    expect(termsBar("www.reddit.com")).not.toBeNull();
    expect(termsBar("example.org")).toBeNull();
    expect(termsBar("notreddit.com")).toBeNull();
    for (const entry of TERMS_BARRED_HOSTS) expect(entry.why.length, entry.host).toBeGreaterThan(20);
  });

  it("leaves Hacker News readable, because it is read through its public API", () => {
    expect(termsBar("www.ycombinator.com")).not.toBeNull();
    expect(termsBar("news.ycombinator.com")).toBeNull();
  });

  it("is off limits together with the hosts that are never requested at all", () => {
    expect(isOffLimitsHost("www.linkedin.com")).toBe(true);
    expect(isOffLimitsHost("x.com")).toBe(true);
    expect(isOffLimitsHost("github.com")).toBe(false);
  });
});
