/**
 * What a failed "Run now" says to the user.
 *
 * A manual run answered `409` is not a fault: the tenant's agent registry has
 * `condition_autodispatch` turned off, and coord (`conditions/routes.rs`,
 * `DispatchOutcome::Vetoed`) refuses with
 * `{"error":"spawn_vetoed","agent_name":…,"disposition":…,"hint":…}` and records
 * NOTHING. A generic "Failed to start run" would read as breakage and send the
 * user looking for an outage, so the veto is named, with coord's own hint.
 *
 * On the wire the body is wrapped once: the web proxy
 * (`conditions.py` → `_proxy_coord_post`, `structured_errors` off) puts coord's
 * body TEXT in `HTTPException.detail`, and the error-handler envelope carries it
 * as `message` — so coord's object may be the body itself (a proxy that opts in
 * to structured errors), or a JSON string inside `message` / `detail`. All three
 * are read; anything else falls back to the envelope's message.
 *
 * The status and body are recovered through the anchored `httpStatusOf` /
 * `httpBodyOf`, never by scanning the error text.
 */

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

interface SpawnVeto {
  disposition: string | null;
  hint: string | null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The objects a 409 body may carry coord's refusal in, outermost first. */
function candidates(body: string): Record<string, unknown>[] {
  const outer = asRecord(parseJson(body));
  if (!outer) return [];
  const out = [outer];
  for (const key of ["message", "detail"] as const) {
    const inner = outer[key];
    const rec =
      typeof inner === "string" ? asRecord(parseJson(inner)) : asRecord(inner);
    if (rec) out.push(rec);
  }
  return out;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Coord's registry veto, if this rejection is one. */
export function spawnVetoOf(err: unknown): SpawnVeto | null {
  if (httpStatusOf(err) !== 409) return null;
  const body = httpBodyOf(err);
  if (body === null) return null;
  for (const c of candidates(body)) {
    if (c.error === "spawn_vetoed") {
      return { disposition: str(c.disposition), hint: str(c.hint) };
    }
  }
  return null;
}

/** The toast text for a failed manual run. */
export function describeRunFailure(err: unknown): string {
  const veto = spawnVetoOf(err);
  if (veto) {
    const disposition = veto.disposition
      ? ` (disposition: ${veto.disposition})`
      : "";
    const sentence =
      "Run not started: regression-test runs are turned off for this project " +
      `in its agent registry — condition_autodispatch is vetoed${disposition}. ` +
      "Nothing was recorded.";
    return veto.hint ? `${sentence} ${veto.hint}` : sentence;
  }
  if (httpStatusOf(err) === 409) {
    // A 409 that is not the veto shape: show coord's words, not a guess.
    // Only the INNERMOST object is read — when coord's body was nested as a
    // JSON string in the envelope's `message`, falling back to the envelope
    // would show that raw JSON. An innermost object with no words of its own
    // gets a generic sentence instead.
    const found = candidates(httpBodyOf(err) ?? "");
    const innermost = found[found.length - 1];
    const message = innermost
      ? (str(innermost.message) ?? str(innermost.hint) ?? str(innermost.error))
      : null;
    return message
      ? `Run not started: ${message}`
      : "Run could not be started (409): the server refused it without saying why.";
  }
  return err instanceof Error ? err.message : "Failed to start run";
}
