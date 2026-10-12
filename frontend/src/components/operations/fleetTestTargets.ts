/**
 * Readable text for a failed test-host designation write.
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

import { httpBodyOf } from "@/components/admin/coord/httpStatus";
import { designationRefusalMessage } from "@/lib/api/fleet";

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
