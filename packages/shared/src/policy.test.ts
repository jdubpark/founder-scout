import { describe, expect, it } from "vitest";
import { isProfessionalNetworkHost, isProfessionalNetworkUrl } from "./policy";

describe("professional-network hosts", () => {
  it("covers the host, its subdomains, and odd spellings, and nothing that merely looks similar", () => {
    for (const host of ["linkedin.com", "www.linkedin.com", "uk.linkedin.com", "LinkedIn.com.", "media.licdn.com", "lnkd.in"]) {
      expect(isProfessionalNetworkHost(host), host).toBe(true);
    }
    for (const host of ["notlinkedin.com", "linkedin.com.example.org", "example.com", "linkedin.co"]) {
      expect(isProfessionalNetworkHost(host), host).toBe(false);
    }
    expect(isProfessionalNetworkUrl("https://www.linkedin.com/in/someone")).toBe(true);
    expect(isProfessionalNetworkUrl("https://example.com/?next=https://www.linkedin.com/in/someone")).toBe(false);
    expect(isProfessionalNetworkUrl("not an address")).toBe(false);
  });
});
