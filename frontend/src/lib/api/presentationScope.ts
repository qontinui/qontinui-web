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
 * rejects with a {@link BackendError} whose `status` the caller branches on. A
 * save's 409 rejects with the {@link PresentationScopeConflict} subclass,
 * which says WHICH half of the compare-and-set refused it: the stored version
 * moved, or the active project is not the one the edit was made for.
 *
 * The URL is covered by `ACTIVE_TENANT_URL_PREFIXES`, so the scope is always
 * the SELECTED project's.
 */

import type { components } from "@/lib/api-client/generated-types";
import {
  BackendError,
  backendError,
  type BackendErrorReading,
} from "@/lib/errors/backend-error-message";
import { httpClient } from "@/services/service-factory";

type Schemas = components["schemas"];
/** The read: the effective lists, the stored row, the defaults, `can_edit`. */
export type PresentationScopeRecord = Schemas["PresentationScopeOut"];
/** The write: replaces the stored row at (`expected_tenant_id`, `expected_version`). */
export type PresentationScopeWrite = Schemas["PresentationScopeWrite"];
/** Why the registered-repository owners could not be read. */
export type PresentationScopeUnknownReason = NonNullable<
  PresentationScopeRecord["first_party_owners_unknown_reason"]
>;

/** Which half of the save's compare-and-set refused it. */
export type PresentationScopeConflictKind =
  /** The stored scope moved since `expected_version`. */
  | "version"
  /** The active project is not `expected_tenant_id`: the edit was made for another. */
  | "tenant";

/** The backend's `error` code for each conflict (`endpoints/presentation.py`). */
const CONFLICT_CODES: Readonly<Record<string, PresentationScopeConflictKind>> =
  {
    presentation_scope_conflict: "version",
    presentation_scope_tenant_mismatch: "tenant",
  };

/** A save refused with a 409, and which conflict refused it. */
export class PresentationScopeConflict extends BackendError {
  readonly conflict: PresentationScopeConflictKind;

  constructor(
    reading: BackendErrorReading,
    conflict: PresentationScopeConflictKind
  ) {
    super(reading, 409);
    this.name = "PresentationScopeConflict";
    this.conflict = conflict;
  }
}

/**
 * The conflict a 409 body names. A body naming neither is read as a version
 * conflict: the caller then re-reads, and keeps an edit only for the project
 * it was made for, so the guess cannot carry an edit across projects.
 */
export function conflictKindOf(text: string): PresentationScopeConflictKind {
  try {
    const body = JSON.parse(text) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : "";
    return CONFLICT_CODES[code] ?? "version";
  } catch {
    return "version";
  }
}

async function readScopeJson(res: Response): Promise<PresentationScopeRecord> {
  if (res.status === 409) {
    const kind = conflictKindOf(await res.clone().text());
    throw new PresentationScopeConflict(
      (await backendError(res)).reading,
      kind
    );
  }
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
 * Replace the active project's stored scope. Rejects with a
 * {@link PresentationScopeConflict} (409) when `expected_version` is no longer
 * the stored version or the active project is not `expected_tenant_id`, and
 * with a 403 BackendError when the caller is not an admin of the active
 * project.
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
