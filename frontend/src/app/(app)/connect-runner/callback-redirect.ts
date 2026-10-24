/**
 * Runner-callback redirect for the `/connect-runner` pairing page.
 *
 * Kept out of `page.tsx` because a Next.js page module may only export the
 * page component (and route config).
 */

/** Response of `POST /api/v1/devices/pair-confirm` (the fields this page reads). */
export interface PairConfirmResult {
  device_id: string;
  token?: string | null;
  state: string;
  collect?: boolean;
}

/**
 * Build the runner-callback redirect. In collect mode the token is NEVER
 * placed in the URL, even when the response carries one.
 */
export function buildCallbackRedirect(
  callback: string,
  state: string,
  result: PairConfirmResult
): URL {
  const redirectUrl = new URL(callback);
  redirectUrl.searchParams.set("state", state);
  if (result.collect === true) {
    redirectUrl.searchParams.set("token_id", result.device_id);
    redirectUrl.searchParams.set("collect", "1");
    return redirectUrl;
  }
  if (!result.token) {
    throw new Error("Pair-confirm response is missing the device token.");
  }
  redirectUrl.searchParams.set("token", result.token);
  redirectUrl.searchParams.set("token_id", result.device_id);
  return redirectUrl;
}

/**
 * Coord pairing refusal codes (relayed by pair-confirm as `coord_code`) the
 * user can act on, mapped to what to tell them. Single-tenant refusals use
 * coord's `pairing_auth` codes; a collect-mode batch refusal uses the batch
 * reason (`no_tenant_authorized`, `probe_failed`, `device_*`).
 */
const COORD_REFUSAL_MESSAGES: Record<string, string> = {
  tenant_membership_required:
    "This account isn't a member of the workspace this device asked to join.",
  not_a_member:
    "This account isn't a member of any of the workspaces this device asked to join.",
  no_tenant_authorized:
    "None of the workspaces this device asked to join could be paired.",
  unknown_state: "This pairing request has expired or was already used.",
  internal_error:
    "Coord couldn't check your workspace membership just now. Try again shortly.",
  // A batch probe_failed is a membership-probe OR a binding failure.
  probe_failed: "Coord hit a temporary error while pairing. Try again shortly.",
  user_not_provisioned:
    "Your account isn't linked to a single sign-on identity coord can verify. Sign in with single sign-on, then try again.",
  device_owned_by_other_user:
    "This device is already paired to a different account.",
  device_unregistered_needs_home:
    "This device isn't registered yet, so it must first be paired with a home workspace.",
};

/**
 * The one reason to report for a collect-mode batch refusal, from its
 * distinct per-tenant `skipped_reason`s. A coord-side failure outranks
 * everything (retrying may succeed), then an account problem that affects
 * every tenant; "not a member" only when it is the sole reason.
 */
function batchRefusalReason(reasons: unknown): string | undefined {
  if (!Array.isArray(reasons)) return undefined;
  const set = new Set(reasons.filter((r) => typeof r === "string"));
  for (const r of ["probe_failed", "user_not_provisioned"]) {
    if (set.has(r)) return r;
  }
  if (set.size === 1 && set.has("not_a_member")) return "not_a_member";
  return undefined;
}

/** The relayed coord refusal fields `pairConfirmErrorMessage` reads. */
interface CoordRefusal {
  coord_status?: unknown;
  coord_code?: unknown;
  coord_hint?: unknown;
  coord_skip_reasons?: unknown;
}

/** Message for a relayed coord pairing refusal. */
function coordRefusalMessage(refusal: CoordRefusal): string {
  const coordStatus = refusal.coord_status;
  let code = typeof refusal.coord_code === "string" ? refusal.coord_code : "";
  if (code === "no_tenant_authorized") {
    // The batch code says nothing about WHY; the per-tenant reasons do.
    code = batchRefusalReason(refusal.coord_skip_reasons) ?? code;
  }
  let message = COORD_REFUSAL_MESSAGES[code];
  if (!message && !code && coordStatus === 403) {
    // A coord build that relays no code: a 403 here is the membership gate.
    message =
      "This account isn't a member of the workspace(s) this device asked to join.";
  }
  if (!message) {
    const statusText =
      typeof coordStatus === "number" ? String(coordStatus) : "?";
    message = `Pairing was refused (coord HTTP ${statusText}${code ? `: ${code}` : ""}).`;
  }
  // Coord's "restart pairing" hint means the one-shot pairing request was
  // used up: retrying from this page cannot succeed. An unknown state means
  // the same thing, and coord sends no hint with it.
  if (refusal.coord_hint === "restart pairing" || code === "unknown_state") {
    message += " Start pairing again from your device.";
  }
  return message;
}

function isCoordRefusal(value: unknown): value is CoordRefusal {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "coord_status" in value
  );
}

/**
 * Human message for a non-OK `POST /api/v1/devices/pair-confirm` answer.
 *
 * The backend's `http_exception_handler` spreads a relayed coord refusal's
 * fields into the TOP LEVEL of the body (`{error, message, coord_status,
 * coord_code, ...}`); a bare FastAPI app nests them under `detail`. Both are
 * read, so the mapping does not depend on which handler served the answer.
 */
export function pairConfirmErrorMessage(
  body: unknown,
  httpStatus: number
): string {
  const b = (body ?? {}) as {
    detail?: unknown;
    message?: unknown;
    error?: unknown;
    details?: unknown;
  };
  // A coord refusal: checked before `message`, which the backend also sets
  // to a generic "Coord refused pairing (...)" on the same body.
  if (isCoordRefusal(b)) {
    return coordRefusalMessage(b);
  }
  if (isCoordRefusal(b.detail)) {
    return coordRefusalMessage(b.detail);
  }
  if (typeof b.detail === "string" && b.detail) {
    return b.detail;
  }
  // A request-validation 422 (e.g. a malformed `state` in the URL the device
  // opened): coord was never asked, so this is not a refusal. The app's
  // handler sends `{error: "VALIDATION_ERROR", details: [{message}]}`; a bare
  // FastAPI app sends `{detail: [{msg}]}`.
  const validation =
    b.error === "VALIDATION_ERROR" && Array.isArray(b.details)
      ? b.details.map((e) => (e as { message?: unknown })?.message)
      : Array.isArray(b.detail)
        ? b.detail.map((e) => (e as { msg?: unknown })?.msg)
        : null;
  if (validation) {
    const msgs = validation.filter(
      (m): m is string => typeof m === "string" && m.length > 0
    );
    return `This pairing link is invalid (HTTP ${httpStatus}${msgs.length ? `: ${msgs.join("; ")}` : ""}). Start pairing again from your device.`;
  }
  // A coord outage is relayed as {error, message} carrying retry advice —
  // top level from the app's handler, nested under `detail` from a bare app.
  if (b.detail && typeof b.detail === "object") {
    const nested = (b.detail as { message?: unknown }).message;
    if (typeof nested === "string" && nested) {
      return nested;
    }
  }
  if (typeof b.message === "string" && b.message) {
    return b.message;
  }
  return `Pair-confirm failed (HTTP ${httpStatus})`;
}
