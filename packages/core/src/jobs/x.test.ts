import { describe, expect, it } from "vitest";
import type { XInvestigateInput, XInvestigateOutput, XSearchInput } from "@agentswarm/shared";
import { normalizeXInvestigation, normalizeXSearch } from "./x";

const post = (id: string, overrides: Partial<XInvestigateOutput["evidence"][number]> = {}): XInvestigateOutput["evidence"][number] => ({
  kind: "post",
  facet: null,
  url: `https://x.com/ada_builds/status/${id}`,
  excerpt: "We shipped the cache today and build times fell by half.",
  claim: "She ships product updates in public.",
  publishedAt: "2026-11-01",
  likes: 12,
  reposts: 3,
  replies: 1,
  views: 900,
  ...overrides,
});

describe("what is kept from a reading of X", () => {
  it("keeps a search hit only when xAI's API returned that post, whatever address the model wrote", () => {
    const input: XSearchInput = { query: "new developer tools", limit: 5, fromDate: "2026-11-06", toDate: "2026-11-14", maxFollowers: 25000 };
    const hits = normalizeXSearch(input, {
      hits: [
        { url: "https://x.com/ada_builds/status/1900000000000000001", title: "Ada (@ada_builds)", snippet: "Launching our cache today." },
        { url: "https://x.com/someone/status/1900000000000000002", title: "Someone (@someone)", snippet: "A post the model remembered." },
        { url: "https://example.com/a-page", title: "Not a post", snippet: "A page the model added." },
        // X's own terms: nothing about a person's money troubles or an alleged crime. A product is not a person.
        { url: "https://x.com/sam_makes/status/1900000000000000005", title: "Sam (@sam_makes)", snippet: "I was broke and had been arrested the year before I started this." },
        { url: "https://x.com/lee_ships/status/1900000000000000006", title: "Lee (@lee_ships)", snippet: "We help people who are in debt pay less interest. Launching today." },
      ],
    }, ["https://x.com/i/status/1900000000000000001", "https://x.com/i/status/1900000000000000005", "https://x.com/i/status/1900000000000000006"]).hits;

    expect(hits.map((hit) => hit.url)).toEqual([
      "https://x.com/ada_builds/status/1900000000000000001",
      "https://x.com/lee_ships/status/1900000000000000006",
    ]);
  });

  it("keeps a founder's evidence only from the account the call was held to, and only posts the API returned", () => {
    const input = { handle: "ada_builds", depth: "standard" } as XInvestigateInput;
    const account = { handle: "@Ada_Builds", name: "Ada", followers: 800, identity: "Bio names Ada and her company Cachely." };
    const cited = [
      "https://x.com/i/status/1900000000000000001",
      "https://x.com/i/status/1900000000000000003",
      // xAI's own address gives this post to another account, whatever the answer wrote.
      "https://x.com/another_ada/status/1900000000000000004",
    ];

    const kept = normalizeXInvestigation(input, {
      account,
      evidence: [
        post("1900000000000000001"),
        post("1900000000000000002"),
        post("1900000000000000003", { url: "https://x.com/another_ada/status/1900000000000000003" }),
        post("1900000000000000004"),
      ],
      notes: "",
    }, cited);
    expect(kept.evidence.map((item) => item.url)).toEqual(["https://x.com/ada_builds/status/1900000000000000001"]);

    const otherAccount = normalizeXInvestigation(input, { account: { ...account, handle: "another_ada" }, evidence: [post("1900000000000000001")], notes: "" }, cited);
    expect(otherAccount).toMatchObject({ account: null, evidence: [] });
  });
});
