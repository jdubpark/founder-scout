/**
 * Short prefixed ids such as `fnd_k3v9x2m1q8ab`. The prefix says what the id
 * refers to, which keeps logs and audit entries readable.
 */

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export type IdPrefix =
  | "swm" // swarm
  | "agt" // agent
  | "fnd" // founder
  | "led" // lead
  | "evd" // evidence
  | "asm" // assessment
  | "out" // outreach action
  | "fbk" // feedback
  | "run" // run
  | "tsk" // task
  | "dir" // directive
  | "cfg" // config
  | "aud"; // audit entry

export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Deterministic id from a seed string, for simulated and test data. */
export function stableId(prefix: IdPrefix, seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    // Bitwise results are signed in JavaScript; keep the hash unsigned so it can index the alphabet.
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  let out = "";
  let a = h1;
  let b = h2;
  for (let i = 0; i < 12; i++) {
    const v = i % 2 === 0 ? a : b;
    out += ALPHABET[(v >>> 0) % ALPHABET.length];
    if (i % 2 === 0) a = Math.imul(a ^ (a >>> 5), 0x9e3779b1) >>> 0;
    else b = Math.imul(b ^ (b >>> 7), 0xc2b2ae35) >>> 0;
  }
  return `${prefix}_${out}`;
}
