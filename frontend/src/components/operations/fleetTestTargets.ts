/**
 * Readable outcomes of the fleet routes' refusals: the app-config
 * platform-admin refusal ({@link isAppConfigAdminRefusal}) and a failed
 * test-host designation write ({@link designationErrorText}).
 *
 * The designation PUT/DELETE proxy to coord's binding-checked writer, and the
 * backend answers a refusal with a typed envelope carrying operator-facing
 * prose (see `designationRefusalMessage`). `httpClient` throws a plain
 * `PUT <url> failed: 409 - <body>`, so without this the panel would toast the
 * URL and raw JSON instead of "Device 'x' is not bound to project "Y" ... Bind
 * the device to "Y", or switch to a project the device is bound to". Plan
 * `2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-bound-to`.
 *
 * Anything that is not one of the backend's own designation refusals — another
 * body, an unparseable one, a network error — falls back to the full error
 * text, so nothing is ever hidden.
 */

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  FleetApiError,
  designationRefusalMessage,
  isPlatformAdminRefusal,
} from "@/lib/api/fleet";

/**
 * Whether a failed app-config read or write (`GET /fleet/apps`, `PATCH
 * /fleet/apps/{app_id}`) is the backend's platform-admin refusal — the caller
 * is signed in but is not a platform admin — rather than a failure.
 *
 * Reads both shapes the fleet UI meets: a {@link FleetApiError} from
 * `lib/api/fleet.ts`, and an `httpClient` rejection
 * (`GET <url> failed: 403 - <body>`), whose status and body are recovered by
 * the console's anchored readers. Anything else — another 403's body, an HTML
 * page, a network error — is not the refusal.
 */
export function isAppConfigAdminRefusal(err: unknown): boolean {
  if (err instanceof FleetApiError) {
    return isPlatformAdminRefusal(err.status, err.body);
  }
  const body = httpBodyOf(err);
  if (body === null) return false;
  try {
    return isPlatformAdminRefusal(httpStatusOf(err), JSON.parse(body));
  } catch {
    // Not JSON (an HTML 403 page from a proxy): not the backend's refusal.
    return false;
  }
}

export function designationErrorText(err: unknown): string {
  const body = httpBodyOf(err);
  if (body) {
    try {
      const message = designationRefusalMessage(JSON.parse(body));
      if (message) return message;
    } catch {
      // Not JSON (an HTML 502 page, plain text): fall through to the raw text.
    }
  }
  return err instanceof Error ? err.message : String(err);
}
