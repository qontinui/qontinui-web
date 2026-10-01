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

/** Human message for a non-OK `POST /api/v1/devices/pair-confirm` answer. */
export function pairConfirmErrorMessage(
  body: unknown,
  httpStatus: number
): string {
  const b = (body ?? {}) as { detail?: unknown; message?: unknown };
  if (typeof b.detail === "string" && b.detail) {
    return b.detail;
  }
  if (b.detail && typeof b.detail === "object") {
    // A coord refusal is relayed as {coord_status, coord_body}.
    const coordStatus = (b.detail as { coord_status?: unknown }).coord_status;
    if (coordStatus === 403) {
      return "This account isn't a member of the workspace(s) this device asked to join.";
    }
    return `Pairing was refused (coord HTTP ${typeof coordStatus === "number" ? coordStatus : "?"}).`;
  }
  if (typeof b.message === "string" && b.message) {
    return b.message;
  }
  return `Pair-confirm failed (HTTP ${httpStatus})`;
}
