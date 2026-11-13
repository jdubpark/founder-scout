/**
 * Substrings that mark a variable as a credential, matched anywhere in the upper-cased name.
 * PGPASSWORD and MY_SECRET_VALUE have no underscore before the word, so a suffix test misses them.
 */
const SECRET_SUBSTRINGS = ["PASSWORD", "PASSWD", "SECRET", "TOKEN"] as const;

/**
 * Underscore-separated name parts that mark a credential. Matched as whole parts so that
 * KEYBOARD_LAYOUT, PWD, OLDPWD and AUTHOR_NAME are kept.
 */
const SECRET_PARTS = new Set(["KEY", "APIKEY", "CREDENTIALS", "CREDENTIAL", "AUTH"]);

/** Names that are secrets whatever their parts are. */
const SECRET_NAMES = new Set(["DATABASE_URL", "GH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN"]);

/**
 * Proxy settings keep their credentials. The tool cannot reach the network without them,
 * so these are exempt from the value rule below.
 */
const PROXY_NAMES = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]);

/** A URL that carries a user name and a password, for any scheme: scheme://user:password@host. */
const CREDENTIAL_IN_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

function looksSecret(name: string, value: string): boolean {
  const upper = name.toUpperCase();
  if (SECRET_NAMES.has(upper)) return true;
  if (SECRET_SUBSTRINGS.some((word) => upper.includes(word))) return true;
  if (upper.split("_").some((part) => SECRET_PARTS.has(part))) return true;
  if (!PROXY_NAMES.has(upper) && CREDENTIAL_IN_URL.test(value)) return true;
  return false;
}

/**
 * A copy of `env` without variables that look like secrets, except those the named tool needs.
 * A variable whose name starts with one of `keepPrefixes` is kept even when it looks secret.
 * Undefined values are dropped. Everything else, such as PATH, HOME and proxy settings, is kept.
 *
 * A variable is dropped when its name contains PASSWORD, PASSWD, SECRET or TOKEN; when one of its
 * underscore-separated parts is KEY, APIKEY, CREDENTIALS, CREDENTIAL or AUTH; when its name is a known
 * secret; or when its value is a URL with a user name and password. SSH_AUTH_SOCK is dropped by the
 * AUTH part. That is acceptable: the headless agents do not need the user's SSH agent.
 */
export function scrubEnv(env: NodeJS.ProcessEnv, keepPrefixes: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const kept = keepPrefixes.some((prefix) => name.startsWith(prefix));
    if (!kept && looksSecret(name, value)) continue;
    out[name] = value;
  }
  return out;
}
