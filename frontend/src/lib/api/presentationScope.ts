/**
 * The presentation scope's client — `/api/v1/presentation/scope`.
 *
 * Plan `2026-10-23-console-presentation-spaces` Phase 1 (D3.3, D3.4). The
 * presentation lens reads it (its ONE read in presentation mode, through
 * `components/presentation/presentationScopeLoader.ts`), and the tenant-policy
 * page's form reads and replaces the stored half.
 *
 * The wire types are the generated ones (`lib/api-client/generated-types.ts`,
 * from the backend's OpenAPI snapshot), so a backend shape change is a type
 * error here, not a silent drift. Conventions are the taste client's: every
 * call goes through `httpClient.fetch` on a RELATIVE URL written inline (so
 * `route-walker.test.ts` checks each one against the snapshot), and a non-2xx
 * rejects with a {@link BackendError} whose `status` the caller branches on (a
 * 409 is "someone saved first" — re-read).
 *
 * The URL is covered by `ACTIVE_TENANT_URL_PREFIXES`, so the scope is always
 * the SELECTED project's.
 */

import type { components } from "@/lib/api-client/generated-types";
import { backendError } from "@/lib/errors/backend-error-message";
import { httpClient } from "@/services/service-factory";

type Schemas = components["schemas"];
/** The read: the effective lists, the stored row, the defaults, `can_edit`. */
export type PresentationScopeRecord = Schemas["PresentationScopeOut"];
/** The write: replaces the stored row at `expected_version`. */
export type PresentationScopeWrite = Schemas["PresentationScopeWrite"];
/** Why the registered-repository owners could not be read. */
export type PresentationScopeUnknownReason = NonNullable<
  PresentationScopeRecord["first_party_owners_unknown_reason"]
>;

async function readScopeJson(res: Response): Promise<PresentationScopeRecord> {
  if (!res.ok) throw await backendError(res);
  return (await res.json()) as PresentationScopeRecord;
}

/** Read the active project's presentation scope. */
export async function fetchPresentationScope(
  options: { signal?: AbortSignal } = {}
): Promise<PresentationScopeRecord> {
  const res = await httpClient.fetch("/api/v1/presentation/scope", {
    method: "GET",
    signal: options.signal,
  });
  return readScopeJson(res);
}

/**
 * Replace the active project's stored scope. Rejects with a 409 BackendError
 * when `expected_version` is no longer the stored version, and with a 403 when
 * the caller is not an admin of the active project.
 */
export async function savePresentationScope(
  body: PresentationScopeWrite
): Promise<PresentationScopeRecord> {
  const res = await httpClient.fetch("/api/v1/presentation/scope", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return readScopeJson(res);
}
