/**
 * A bounded per-signature throttle: admits a signature at most once per
 * window, and never remembers more than `max` signatures.
 *
 * Used by the telemetry beacon so a burst of identical incidents (11
 * `/operations/*` 504s on one load, coord finding 687e0dbd) is one envelope,
 * not eleven.
 */

export interface SignatureThrottle {
  /** True (and remembered) when `signature` has not been admitted within the window. */
  admit(signature: string, now: number): boolean;
  /** How many signatures are currently remembered. */
  size(): number;
}

export function createSignatureThrottle(opts: {
  windowMs: number;
  max: number;
}): SignatureThrottle {
  // Insertion order tracks recency: a re-admitted signature is re-inserted.
  const lastAdmitted = new Map<string, number>();

  function evict(now: number): void {
    if (lastAdmitted.size <= opts.max) return;
    for (const [sig, t] of lastAdmitted) {
      if (now - t >= opts.windowMs) lastAdmitted.delete(sig);
    }
    // Still over the bound: drop the oldest.
    while (lastAdmitted.size > opts.max) {
      const oldest = lastAdmitted.keys().next().value;
      if (oldest === undefined) break;
      lastAdmitted.delete(oldest);
    }
  }

  return {
    admit(signature, now) {
      const last = lastAdmitted.get(signature);
      if (last !== undefined && now - last < opts.windowMs) return false;
      lastAdmitted.delete(signature);
      lastAdmitted.set(signature, now);
      evict(now);
      return true;
    },
    size() {
      return lastAdmitted.size;
    },
  };
}
