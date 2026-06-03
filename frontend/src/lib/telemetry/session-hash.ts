/**
 * Ξ_ClientTelemetry — ephemeral session hash (plan §3.1 / §3.6).
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * A non-reversible, salted, EPHEMERAL per-page-load session identifier used
 * ONLY for dedup + distinct-affected-session counts (blast radius). It is NOT a
 * stable user id.
 *
 * ★ LOAD-BEARING EPHEMERALITY (plan §3.6): this value is generated once per
 * page-load and held ONLY in module memory. It is NEVER persisted to
 * localStorage, sessionStorage, cookies, IndexedDB, or any device storage. This
 * is what keeps the beacon OUT of the ePrivacy/PECR "storing/accessing
 * information on the device" consent-banner trigger — persisting it would flip
 * the whole layer back into banner territory. Do not "optimize" this into a
 * stored value.
 *
 * The salt is a fresh per-page-load random value mixed into the hash so the
 * output is non-reversible to the raw randomness and is not correlatable across
 * page loads.
 */

// In-memory only. Never read from / written to any storage API. Reset on every
// fresh module load (i.e. every page load).
let cachedHash: string | null = null;

/**
 * Generate a fresh, salted, non-reversible session token. Uses
 * ``crypto.randomUUID`` / ``crypto.getRandomValues`` when available, with a
 * non-crypto fallback for non-browser/test contexts. The result is hashed (FNV)
 * with a per-call salt so the stored value is one-way.
 */
function generate(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;

  let entropy: string;
  if (cryptoObj?.randomUUID) {
    entropy = cryptoObj.randomUUID();
  } else if (cryptoObj?.getRandomValues) {
    const arr = new Uint32Array(4);
    cryptoObj.getRandomValues(arr);
    entropy = Array.from(arr, (n) => n.toString(16)).join("");
  } else {
    // Non-crypto fallback (test / SSR). Not security-critical: the value is a
    // dedup token, not an auth secret.
    entropy = `${Date.now().toString(16)}-${Math.random()
      .toString(16)
      .slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  // Per-call salt mixed in so the output is non-reversible to the entropy.
  const salt =
    cryptoObj?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return fnv1aHex(`${salt}:${entropy}`);
}

/** Non-cryptographic one-way digest (FNV-1a, 32-bit), hex-encoded. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (keeps it within Number range).
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Get the ephemeral per-page-load session hash, generating it once on first
 * use and caching it IN MEMORY ONLY for the rest of the page's lifetime.
 */
export function getSessionHash(): string {
  if (cachedHash === null) {
    cachedHash = generate();
  }
  return cachedHash;
}

/**
 * Test-only: reset the in-memory cache so a test can assert that a fresh value
 * is generated. Not used in production.
 */
export function __resetSessionHashForTests(): void {
  cachedHash = null;
}
