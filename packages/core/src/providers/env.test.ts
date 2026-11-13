import { describe, expect, it } from "vitest";
import { scrubEnv } from "./env";

describe("scrubEnv", () => {
  it("drops variables whose names end in a secret suffix, in any case", () => {
    const out = scrubEnv(
      {
        A_KEY: "1",
        B_token: "2",
        C_SECRET: "3",
        D_PASSWORD: "4",
        E_PASSWD: "5",
        F_CREDENTIALS: "6",
        G_AUTH: "7",
      },
      [],
    );
    expect(out).toEqual({});
  });

  it("drops the named secret variables that do not end in a suffix", () => {
    const out = scrubEnv({ DATABASE_URL: "postgres://x", GH_TOKEN: "a", GITHUB_TOKEN: "b", NPM_TOKEN: "c" }, []);
    expect(out).toEqual({});
  });

  it("keeps ordinary variables such as PATH, HOME, locale, temp dir, proxy and certificate paths", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      USER: "test",
      LANG: "en_US.UTF-8",
      TMPDIR: "/var/folders/x",
      HTTPS_PROXY: "http://proxy:3128",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/ca.pem",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
    };
    expect(scrubEnv(env, [])).toEqual(env);
  });

  it("keeps a secret-looking variable when its name starts with a keep prefix", () => {
    const out = scrubEnv({ ANTHROPIC_API_KEY: "own", ANTHROPIC_AUTH_TOKEN: "own", CLAUDE_CODE_OAUTH_TOKEN: "own" }, [
      "ANTHROPIC_",
      "CLAUDE_",
    ]);
    expect(out).toEqual({ ANTHROPIC_API_KEY: "own", ANTHROPIC_AUTH_TOKEN: "own", CLAUDE_CODE_OAUTH_TOKEN: "own" });
  });

  it("drops another vendor's key even when a different prefix is kept", () => {
    const out = scrubEnv({ OPENAI_API_KEY: "other", ANTHROPIC_API_KEY: "own" }, ["ANTHROPIC_"]);
    expect(out).toEqual({ ANTHROPIC_API_KEY: "own" });
  });

  it("drops undefined values and does not mutate the input", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/bin", MISSING: undefined };
    const out = scrubEnv(env, []);
    expect(out).toEqual({ PATH: "/bin" });
    expect(env).toHaveProperty("MISSING");
  });
});
