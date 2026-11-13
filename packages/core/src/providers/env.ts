/**
 * Names that look like credentials. Matched on the upper-cased name.
 *
 * The headless agents read untrusted pages and repositories, so a hijacked agent
 * should find nothing it could use against other services. Keys for other vendors,
 * code-host tokens and data-vendor keys are left out of the child environment.
 */
const SECRET_SUFFIXES = ["_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_PASSWD", "_CREDENTIALS", "_AUTH"] as const;
const SECRET_NAMES = new Set(["DATABASE_URL", "GH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN"]);

function looksSecret(name: string): boolean {
  const upper = name.toUpperCase();
  return SECRET_NAMES.has(upper) || SECRET_SUFFIXES.some((suffix) => upper.endsWith(suffix));
}

/**
 * A copy of `env` without variables that look like secrets, except those the named tool needs.
 * A variable whose name starts with one of `keepPrefixes` is kept even when it looks secret.
 * Undefined values are dropped. Everything else, such as PATH, HOME and proxy settings, is kept.
 */
export function scrubEnv(env: NodeJS.ProcessEnv, keepPrefixes: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const kept = keepPrefixes.some((prefix) => name.startsWith(prefix));
    if (!kept && looksSecret(name)) continue;
    out[name] = value;
  }
  return out;
}
