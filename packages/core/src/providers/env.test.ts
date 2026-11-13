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

  it("drops the named secret variables", () => {
    const out = scrubEnv({ DATABASE_URL: "postgres://db", GH_TOKEN: "a", GITHUB_TOKEN: "b", NPM_TOKEN: "c" }, []);
    expect(out).toEqual({});
  });

  it("drops a password or secret word with no underscore before it", () => {
    expect(scrubEnv({ PGPASSWORD: "pw" }, [])).toEqual({});
  });

  it("drops a secret word that sits in the middle of the name", () => {
    expect(scrubEnv({ MY_SECRET_VALUE: "x", SLACK_BOT_TOKEN_2: "y" }, [])).toEqual({});
  });

  it("drops a credential part that is not at the end of the name", () => {
    expect(scrubEnv({ STRIPE_KEY: "x", SERVICE_KEY_ID: "y", APIKEY: "z" }, [])).toEqual({});
  });

  it("keeps names that only contain a credential word inside another word", () => {
    const env = { KEYBOARD_LAYOUT: "us", AUTHOR_NAME: "Ada", PWD: "/work", OLDPWD: "/home" };
    expect(scrubEnv(env, [])).toEqual(env);
  });

  it("drops SSH_AUTH_SOCK by the AUTH part, which is acceptable because headless agents do not need the SSH agent", () => {
    expect(scrubEnv({ SSH_AUTH_SOCK: "/tmp/ssh-agent.sock" }, [])).toEqual({});
  });

  it("drops a value that is a URL with a user name and password, for any scheme", () => {
    const out = scrubEnv(
      {
        REDIS_URL: "redis://user:secret@host:6379",
        FTP_ADDR: "ftp://ada:pw@files.example.com/x",
        CUSTOM: "https://bot:hunter2@api.example.com",
      },
      [],
    );
    expect(out).toEqual({});
  });

  it("keeps a URL with a host and port but no credentials", () => {
    const env = { REDIS_URL_PUBLIC: "redis://host:6379/0", API_BASE: "https://api.example.com:443/v1" };
    expect(scrubEnv(env, [])).toEqual(env);
  });

  it("keeps proxy settings even when they carry credentials", () => {
    const env = {
      HTTP_PROXY: "http://ada:pw@proxy:3128",
      HTTPS_PROXY: "http://ada:pw@proxy:3128",
      ALL_PROXY: "socks5://ada:pw@proxy:1080",
      NO_PROXY: "localhost,127.0.0.1",
      http_proxy: "http://ada:pw@proxy:3128",
      https_proxy: "http://ada:pw@proxy:3128",
    };
    expect(scrubEnv(env, [])).toEqual(env);
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

  it("keeps a secret-looking variable when its name starts with a keep prefix, over every rule", () => {
    const out = scrubEnv(
      {
        ANTHROPIC_API_KEY: "own",
        ANTHROPIC_AUTH_TOKEN: "own",
        CLAUDE_CODE_OAUTH_TOKEN: "own",
        CLAUDE_PASSWORD_HINT: "own",
        ANTHROPIC_BASE_URL: "https://bot:pw@gateway.example.com",
      },
      ["ANTHROPIC_", "CLAUDE_"],
    );
    expect(out).toEqual({
      ANTHROPIC_API_KEY: "own",
      ANTHROPIC_AUTH_TOKEN: "own",
      CLAUDE_CODE_OAUTH_TOKEN: "own",
      CLAUDE_PASSWORD_HINT: "own",
      ANTHROPIC_BASE_URL: "https://bot:pw@gateway.example.com",
    });
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
