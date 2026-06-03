/**
 * Ξ_ClientTelemetry — client-side scrubbing (plan §3.2).
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * ALLOWLIST, not denylist. These are real users' browsers, so PII/secret
 * scrubbing is a correctness requirement, not a nicety. This is the FIRST of
 * two scrubbing passes (the ingest does the authoritative second pass — never
 * trust the client, §3.2).
 *
 * Rules enforced here:
 *  - URLs → ship ``request_host`` + a path TEMPLATE only. NEVER raw URLs:
 *    query strings + fragments + path-params carry tokens / emails / ids.
 *  - Error messages → DROP the raw free-text body entirely; ship only the
 *    error class/name + a normalized template token (the body is the single
 *    likeliest PII-leak vector AND a signal-quality win to drop).
 *  - Stacks → symbol names + ``file:line`` only; never raw eval/inline content.
 *  - NEVER cookies, localStorage, form values, request/response bodies, secret
 *    values, or client IP.
 *
 * All functions here are PURE and unit-testable.
 */

import type { ClientTelemetryFrame } from "./types";

/**
 * Extract just the host from a URL string. Returns ``undefined`` when the
 * input cannot be parsed as a URL (so we never leak a raw, unparsed string).
 *
 * NEVER returns path / query / fragment — host is the diagnostic, the rest is
 * redacted (§3.2). For relative URLs the host is resolved against the current
 * origin so a same-origin fetch is attributed correctly.
 */
export function scrubHost(
  rawUrl: string,
  baseOrigin?: string
): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const base =
      baseOrigin ??
      (typeof window !== "undefined" ? window.location?.origin : undefined);
    const u = base ? new URL(rawUrl, base) : new URL(rawUrl);
    return u.host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reduce a URL's path to a template: drop query + fragment, and replace
 * path SEGMENTS that look like identifiers (numeric ids, uuids, emails,
 * long opaque tokens) with ``:id`` placeholders. Conservative — when in
 * doubt, redact the segment (a stray un-templated id would leak PII).
 *
 * NEVER returns query or fragment. Returns ``undefined`` on unparseable input.
 */
export function scrubPathTemplate(
  rawUrl: string,
  baseOrigin?: string
): string | undefined {
  if (!rawUrl) return undefined;
  let pathname: string;
  try {
    const base =
      baseOrigin ??
      (typeof window !== "undefined" ? window.location?.origin : undefined);
    const u = base ? new URL(rawUrl, base) : new URL(rawUrl);
    pathname = u.pathname;
  } catch {
    // Not a full URL — treat the input as a bare path, but only keep the
    // part before any ? or # so we never ship a query/fragment.
    pathname = rawUrl.split(/[?#]/, 1)[0] ?? "";
    if (!pathname.startsWith("/")) return undefined;
  }

  const segments = pathname.split("/").map((seg) => {
    if (seg === "") return seg;
    if (looksLikeIdentifier(seg)) return ":id";
    return seg;
  });
  return segments.join("/") || "/";
}

/**
 * Heuristic: does a path segment look like a per-request identifier (vs a
 * static route name)? Conservative toward redaction.
 */
function looksLikeIdentifier(seg: string): boolean {
  const decoded = safeDecode(seg);
  // numeric id
  if (/^\d+$/.test(decoded)) return true;
  // uuid
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      decoded
    )
  )
    return true;
  // email-ish (contains @)
  if (decoded.includes("@")) return true;
  // long opaque token (>= 24 chars of base64/hex-ish) — likely a token/id
  if (/^[A-Za-z0-9._\-+/=]{24,}$/.test(decoded)) return true;
  return false;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Normalize an error message into a class/shape TEMPLATE — the raw free-text
 * body is DROPPED entirely (§3.2 allowlist-not-denylist). We return ONLY a
 * coarse, non-identifying token derived from the error NAME and a small set of
 * recognized structural shapes. The raw ``message`` is never returned.
 *
 * @param errorName  the error constructor name (e.g. ``TypeError``)
 * @param rawMessage the raw message — used ONLY to detect a known structural
 *                   shape; its content is NEVER emitted.
 */
export function normalizeErrorMessage(
  errorName: string,
  rawMessage?: string
): string {
  const name = (errorName || "Error").trim() || "Error";
  // Detect a few well-known, non-identifying structural shapes purely by
  // pattern — we emit the SHAPE token, never the raw text.
  const msg = rawMessage ?? "";
  if (/failed to fetch/i.test(msg)) return `${name}:failed_to_fetch`;
  if (/load failed/i.test(msg)) return `${name}:load_failed`;
  if (/networkerror/i.test(msg)) return `${name}:network_error`;
  if (/hydrat/i.test(msg)) return `${name}:hydration`;
  if (/chunk.*load/i.test(msg) || /loading chunk/i.test(msg))
    return `${name}:chunk_load`;
  if (/content security policy/i.test(msg) || /csp/i.test(msg))
    return `${name}:csp`;
  // Default: ship ONLY the class name. The body is dropped.
  return name;
}

/**
 * Scrub a single stack frame down to a symbol name + ``file:line`` (§3.2).
 * Strips any URL host/query from the file (keeps a bundle-relative hint only)
 * and drops ``eval``/inline/anonymous synthetic locations.
 */
export function scrubFrame(frame: {
  symbol?: string;
  file?: string;
  line?: number;
  column?: number;
}): ClientTelemetryFrame {
  const symbol = (frame.symbol || "<anonymous>").trim() || "<anonymous>";
  let file: string | undefined;
  if (frame.file) {
    // Drop eval / inline synthetic sources entirely.
    if (/^eval/i.test(frame.file) || /<anonymous>/.test(frame.file)) {
      file = undefined;
    } else {
      try {
        // Reduce a full URL to just its pathname's basename-ish tail so we keep
        // a bundle file hint without the host or any query string.
        const u = new URL(frame.file);
        file = u.pathname;
      } catch {
        // Already a bare path or unparseable — strip any query/fragment.
        file = frame.file.split(/[?#]/, 1)[0];
      }
    }
  }
  return {
    symbol,
    ...(file ? { file } : {}),
    ...(typeof frame.line === "number" ? { line: frame.line } : {}),
    ...(typeof frame.column === "number" ? { column: frame.column } : {}),
  };
}

/**
 * Parse + scrub a raw ``Error.stack`` string into the top ``maxFrames`` frames
 * (symbol + file:line only). Best-effort across Chrome/Firefox/Safari stack
 * formats — anything it cannot confidently parse is dropped rather than shipped
 * raw.
 */
export function scrubStack(
  rawStack: string | undefined,
  maxFrames = 10
): ClientTelemetryFrame[] {
  if (!rawStack) return [];
  const lines = rawStack.split("\n");
  const frames: ClientTelemetryFrame[] = [];
  for (const line of lines) {
    const parsed = parseStackLine(line);
    if (parsed) {
      frames.push(scrubFrame(parsed));
      if (frames.length >= maxFrames) break;
    }
  }
  return frames;
}

/** Parse one stack line into {symbol, file, line, column}; null if not a frame. */
function parseStackLine(line: string): {
  symbol?: string;
  file?: string;
  line?: number;
  column?: number;
} | null {
  const trimmed = line.trim();
  // V8/Chrome: "at functionName (file:line:col)" or "at file:line:col"
  const v8 = /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(trimmed);
  if (v8) {
    return {
      symbol: v8[1],
      file: v8[2],
      line: Number(v8[3]),
      column: Number(v8[4]),
    };
  }
  // Firefox/Safari: "functionName@file:line:col"
  const ff = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(trimmed);
  if (ff) {
    return {
      symbol: ff[1] || undefined,
      file: ff[2],
      line: Number(ff[3]),
      column: Number(ff[4]),
    };
  }
  return null;
}

/** Coarse browser family for blast-radius (NOT fingerprinting, §3.1). */
export function browserFamily(userAgent?: string): string {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "") ??
    "";
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}
