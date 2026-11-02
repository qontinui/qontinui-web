/**
 * Retry policy and failure wording for the Dev Ops dashboard's coord-proxied
 * polls (plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`,
 * D2 / D4 / D5).
 *
 * ## No retries
 *
 * `httpClient` retries every 5xx on a GET, at up to 5 requests per call with
 * 1 s + 2 s + 4 s of backoff. For a poll that is pure multiplication: the next
 * tick asks the same question anyway, and when coord is slow each retry is one
 * more census read it has to abandon. On 2026-09-22 a failing worktree-slots
 * poll was measured at 5 requests per MINUTE (1 per minute when healthy). One
 * poll per minute times up to 5 requests per failing GET fits that, but why
 * the 30 s timer ran once a minute is UNKNOWN, so the per-tick cost was not
 * measured directly. So every coord-proxied dashboard poll
 * passes {@link COORD_DASHBOARD_POLL_OPTIONS}: one request, and the next poll
 * is the retry.
 *
 * ## Two coord answers that are not "the route failed"
 *
 * - **`503 {"error":"deadline","budget_ms":N,"loader":"census",…}`** — coord
 *   gave up on its own read at its route budget (D2). Nothing was measured, so
 *   the surface is UNKNOWN, and the text names the budget — and, when coord
 *   says, the step that ran out (`census` is a slow database scan,
 *   `pool_acquire` a coord with no free connection: different faults the same
 *   503 would otherwise hide). Never zero, never empty, never healthy
 *   ([policy: `unknown-must-not-render-as-a-default`]).
 * - **`404 {"error":"route_disabled"}`** — an operator switched the route off
 *   (D4's kill switch or tenant dial). That is a deliberate state, not a
 *   route this build lacks, and saying "not shipped yet" about it would be a
 *   false reason.
 *
 * The body is read only through the anchored `httpBodyOf` / from a `Response`
 * the caller already holds, and it is parsed as JSON and checked field by
 * field. Anything that does not match exactly falls through to the caller's
 * existing wording.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Per-request options for every coord-proxied dashboard poll: exactly one request. */
export const COORD_DASHBOARD_POLL_OPTIONS: HttpOptions = { maxRetries: 0 };

/** What a coord error answer means for a dashboard surface. */
export type CoordErrorKind =
  | { kind: "deadline"; budgetMs: number | null; loader: string | null }
  | { kind: "route_disabled" }
  | { kind: "route_unavailable" }
  | { kind: "other" };

/**
 * Statuses meaning "this deployment does not serve the route" — the same
 * family `useSessionCompliance` uses. A 404 that carries `route_disabled` is
 * classified before this set is consulted.
 */
const ROUTE_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

function parseErrorBody(
  bodyText: string | null
): Record<string, unknown> | null {
  if (!bodyText) return null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A loader name as coord's fleet routes serve it (`pool_acquire`, `census`,
 * `target_window`, …). Anything else — a long string, markup, a number — is
 * dropped rather than rendered: this text lands in a banner.
 */
const LOADER_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** Classify a coord answer from its status and raw body text. Pure. */
export function classifyCoordError(
  status: number | null,
  bodyText: string | null
): CoordErrorKind {
  if (status === null) return { kind: "other" };
  const body = parseErrorBody(bodyText);
  if (status === 503 && body?.error === "deadline") {
    const budget = body.budget_ms;
    const loader = body.loader;
    return {
      kind: "deadline",
      budgetMs:
        typeof budget === "number" && Number.isFinite(budget) ? budget : null,
      // `null` both when coord sent none (a route that does not name its
      // loaders, or a deadline that fired before any loader started) and
      // when the value is not a loader name.
      loader:
        typeof loader === "string" && LOADER_NAME.test(loader) ? loader : null,
    };
  }
  if (status === 404 && body?.error === "route_disabled") {
    return { kind: "route_disabled" };
  }
  if (ROUTE_UNAVAILABLE_STATUSES.has(status)) {
    return { kind: "route_unavailable" };
  }
  return { kind: "other" };
}

/**
 * The UNKNOWN wording for a coord read deadline, naming the budget and, when
 * coord named it, the loader that was running when the budget ran out.
 */
export function deadlineText(
  budgetMs: number | null,
  loader: string | null = null
): string {
  const budget = budgetMs === null ? "its budget" : `${budgetMs} ms`;
  const where = loader === null ? "" : ` in its ${loader} step`;
  return `coord read deadline (${budget}) exceeded${where} — unknown`;
}

/** The wording for a route an operator switched off. */
export const ROUTE_DISABLED_TEXT = "disabled by operator";

/**
 * Banner text for an `httpClient` rejection from a coord-proxied poll.
 *
 * `routeUnavailableText` is the surface's own wording for a route this
 * deployment does not serve (404/405/501 without `route_disabled`); omit it
 * and those statuses fall through to the raw message like any other failure.
 */
export function describeCoordPollError(
  err: unknown,
  options: { routeUnavailableText?: string } = {}
): string {
  const verdict = classifyCoordError(httpStatusOf(err), httpBodyOf(err));
  switch (verdict.kind) {
    case "deadline":
      return deadlineText(verdict.budgetMs, verdict.loader);
    case "route_disabled":
      return ROUTE_DISABLED_TEXT;
    case "route_unavailable":
      if (options.routeUnavailableText) return options.routeUnavailableText;
      break;
    case "other":
      break;
  }
  return err instanceof Error ? err.message : String(err);
}
