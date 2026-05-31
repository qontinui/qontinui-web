/**
 * Cross-IdP "Connected accounts" API — list / link / unlink the federated
 * identities attached to the caller's canonical Cognito account.
 *
 * Every call rides the EXISTING canonical session: `httpClient` attaches
 * `Authorization: Bearer <canonical access token>` from the shared
 * `tokenManager`. None of these calls mint or store a session token, so they
 * cannot clobber the canonical session — the link round-trip's federated
 * id_token only travels in the request body (see `linkIdentity`).
 *
 * Backend: `backend/app/api/v1/endpoints/auth/identities.py`.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

/** Provider name for the synthetic native (account-itself) identity. */
export const NATIVE_PROVIDER = "Cognito";

/** One identity linked to the caller's canonical account. */
export interface LinkedIdentity {
  /** Provider name, e.g. "Cognito" (native), "Google", "SignInWithApple". */
  provider: string;
  /** Provider type, e.g. "Google", "SAML", "OIDC", "Cognito". */
  provider_type: string | null;
  /** Provider-scoped user id (pool Username for the native identity). */
  user_id: string | null;
  /** Whether this is the primary identity. */
  primary: boolean;
  /** Email on the account, if known. */
  email: string | null;
  /** Whether the email is verified, if known. */
  email_verified: boolean | null;
}

/** Shape of GET /identities, POST /identities/link and DELETE responses. */
export interface IdentityListResponse {
  identities: LinkedIdentity[];
}

const IDENTITIES_PATH = "/api/v1/auth/identities";

/** GET the identities linked to the caller's canonical account. */
export async function listIdentities(): Promise<IdentityListResponse> {
  return httpClient.get<IdentityListResponse>(IDENTITIES_PATH);
}

/**
 * POST a fresh federated `id_token` to link that identity into the caller's
 * canonical account. The token is sent ONLY in the body; the request is
 * authenticated by the canonical bearer that `httpClient` attaches, so the
 * canonical session is never replaced. Returns the refreshed identity list.
 */
export async function linkIdentity(
  idToken: string
): Promise<IdentityListResponse> {
  return httpClient.post<IdentityListResponse>(`${IDENTITIES_PATH}/link`, {
    id_token: idToken,
  });
}

/** Error thrown by `unlinkIdentity`, carrying the HTTP status + server reason. */
export class UnlinkIdentityError extends Error {
  readonly status: number;
  /** True for the 409 lockout/native-identity guard (a user-fixable refusal). */
  readonly isLockout: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UnlinkIdentityError";
    this.status = status;
    this.isLockout = status === 409;
  }
}

/**
 * DELETE a linked provider. On 409 (lockout guard — last/native identity) the
 * server's human-readable reason is surfaced via `UnlinkIdentityError` so the
 * UI can explain WHY the unlink was refused (no-surprise reversibility).
 * Returns the refreshed identity list.
 */
export async function unlinkIdentity(
  provider: string
): Promise<IdentityListResponse> {
  // Use the raw fetch wrapper (not `httpClient.delete`) so we can read the
  // error body and distinguish the 409 lockout from a generic failure. The
  // `.get/.post` helpers prepend the API base for us, but the raw `.fetch`
  // does not, so build the absolute URL here (same as those helpers do).
  const url = `${ApiConfig.getBaseUrl()}${IDENTITIES_PATH}/${encodeURIComponent(
    provider
  )}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
  });

  if (!res.ok) {
    let detail = `Unlink failed (${res.status}).`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new UnlinkIdentityError(res.status, detail);
  }

  return (await res.json()) as IdentityListResponse;
}
