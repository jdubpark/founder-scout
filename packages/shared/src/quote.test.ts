import { describe, expect, it } from "vitest";
import { quoteInPost } from "./quote";

describe("a quote from a post", () => {
  it("lets a link-shaped word stand for a link only where the post has one", () => {
    const cases: Array<[post: string, quote: string, status: string]> = [
      // X shortens the link; the copy wrote the address it leads to, or left it out.
      ["We shipped the first version of Northstar today. https://t.co/Ab12Cd34Ef", "We shipped the first version of Northstar today. northstar.dev/launch", "found"],
      ["Try it at https://t.co/x1 and tell us what breaks first", "Try it at acme.studio and tell us what breaks first", "found"],
      ["Try it at https://t.co/x1 and tell us what breaks first", "Try it at and tell us what breaks first", "found"],
      // An ordinary word cannot take a link's place.
      ["We are https://t.co/x1 profitable this quarter already", "We are not profitable this quarter already", "not_found"],
      // A dotted word where the post has no link is compared as the words it is, on both sides.
      ["We are profitable this quarter already", "We are not.yet profitable this quarter already", "not_found"],
      ["We are not.yet profitable this quarter", "We are profitable this quarter", "not_found"],
      ["We are not.yet profitable this quarter", "We are not.yet profitable this quarter", "found"],
      // A link does not count towards the four words a stretch needs.
      ["Try it: https://t.co/x1", "Try it: https://acme.studio/launch?utm=1", "too_short"],
      // The copy joined with a dash two words the post has a link between.
      ["We built https://t.co/x1 world class tools today", "We built—world class tools today", "found"],
      // Neither side is shortened into a match: a cut post makes no new word, a long quote is not cut.
      [`${"x ".repeat(14_998)}failure`, "x x x fail", "not_found"],
      ["we shipped our product", `we shipped our product${" ".repeat(4_000)}these words were invented`, "not_found"],
    ];
    for (const [post, quote, status] of cases) {
      expect(quoteInPost(post, quote).status, `${post} | ${quote}`).toBe(status);
    }
  });
});
