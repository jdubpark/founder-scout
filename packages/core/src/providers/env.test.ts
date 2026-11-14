import { describe, expect, it } from "vitest";
import { scrubEnv } from "./env";

describe("scrubEnv", () => {
  it.each([
    [
      "credential names and safe substrings",
      {
        A_KEY: "1", B_token: "2", C_SECRET: "3", D_PASSWORD: "4", E_PASSWD: "5",
        F_CREDENTIALS: "6", G_AUTH: "7",
        DATABASE_URL: "postgres://db", GH_TOKEN: "a", GITHUB_TOKEN: "b", NPM_TOKEN: "c",
        PGPASSWORD: "pw", MY_SECRET_VALUE: "x", SLACK_BOT_TOKEN_2: "y", STRIPE_KEY: "x",
        SERVICE_KEY_ID: "y", APIKEY: "z", SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        KEYBOARD_LAYOUT: "us", AUTHOR_NAME: "Ada", PWD: "/work", OLDPWD: "/home",
      },
      { KEYBOARD_LAYOUT: "us", AUTHOR_NAME: "Ada", PWD: "/work", OLDPWD: "/home" },
    ],
    [
      "credential-bearing URLs but keeps public URLs",
      {
        REDIS_URL: "redis://user:secret@host:6379",
        FTP_ADDR: "ftp://ada:pw@files.example.com/x",
        CUSTOM: "https://bot:hunter2@api.example.com",
        REDIS_URL_PUBLIC: "redis://host:6379/0",
        API_BASE: "https://api.example.com:443/v1",
      },
      { REDIS_URL_PUBLIC: "redis://host:6379/0", API_BASE: "https://api.example.com:443/v1" },
    ],
    [
      "proxy credentials and ordinary runtime paths",
      {
        HTTP_PROXY: "http://ada:pw@proxy:3128", HTTPS_PROXY: "http://ada:pw@proxy:3128",
        ALL_PROXY: "socks5://ada:pw@proxy:1080", NO_PROXY: "localhost,127.0.0.1",
        http_proxy: "http://ada:pw@proxy:3128", https_proxy: "http://ada:pw@proxy:3128",
        PATH: "/usr/bin", HOME: "/Users/test", USER: "test", LANG: "en_US.UTF-8",
        TMPDIR: "/var/folders/x", NODE_EXTRA_CA_CERTS: "/etc/ssl/ca.pem", SSL_CERT_FILE: "/etc/ssl/cert.pem",
      },
      {
        HTTP_PROXY: "http://ada:pw@proxy:3128", HTTPS_PROXY: "http://ada:pw@proxy:3128",
        ALL_PROXY: "socks5://ada:pw@proxy:1080", NO_PROXY: "localhost,127.0.0.1",
        http_proxy: "http://ada:pw@proxy:3128", https_proxy: "http://ada:pw@proxy:3128",
        PATH: "/usr/bin", HOME: "/Users/test", USER: "test", LANG: "en_US.UTF-8",
        TMPDIR: "/var/folders/x", NODE_EXTRA_CA_CERTS: "/etc/ssl/ca.pem", SSL_CERT_FILE: "/etc/ssl/cert.pem",
      },
    ],
    [
      "only the provider's explicitly kept credentials",
      {
        ANTHROPIC_API_KEY: "own", ANTHROPIC_AUTH_TOKEN: "own", CLAUDE_CODE_OAUTH_TOKEN: "own",
        CLAUDE_PASSWORD_HINT: "own", ANTHROPIC_BASE_URL: "https://bot:pw@gateway.example.com",
        OPENAI_API_KEY: "other",
      },
      {
        ANTHROPIC_API_KEY: "own", ANTHROPIC_AUTH_TOKEN: "own", CLAUDE_CODE_OAUTH_TOKEN: "own",
        CLAUDE_PASSWORD_HINT: "own", ANTHROPIC_BASE_URL: "https://bot:pw@gateway.example.com",
      },
    ],
  ])("%s", (_case, input, expected) => {
    expect(scrubEnv(input, ["ANTHROPIC_", "CLAUDE_"])).toEqual(expected);
  });

  it("drops undefined values without mutating the original environment", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/bin", MISSING: undefined };
    expect(scrubEnv(env, [])).toEqual({ PATH: "/bin" });
    expect(env).toHaveProperty("MISSING");
  });
});
