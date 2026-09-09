/**
 * onboarding-pending — the keyed "did coord see this App install?" read.
 *
 * `coord.pending_installations` is written when the GitHub App is installed on
 * an account no tenant owns yet, and until plan
 * `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`
 * (P1) it had no frontend surface at all: an operator who installed the App
 * from GitHub's own pages got no signal that anything happened, and typed the
 * org into the connect card blind.
 *
 * The read is KEYED — by the `installation_id` GitHub put in its Setup-URL
 * redirect, or by the org login the operator typed — never listed. The table
 * has no tenant column (a row is pending precisely because nobody owns it), so
 * a tenant-wide list would be empty by definition or leak every other
 * prospective tenant's org. Coord returns `repo_count`, not the repo list.
 *
 * Two consumers:
 *   - `ConnectInstalledOrg` pre-checks the typed org and says what coord knows
 *     before the authorize click ({@link describePendingInstallation}).
 *   - the onboarding-status recover card looks up the stateless arrival's
 *     `installation_id` and composes its own copy from the {@link classifyPendingInstallation}
 *     verdict.
 *
 * The four verdicts are kept apart on purpose, and the fourth is the one that
 * matters: `pending: null` means the table is ABSENT on this coord — UNKNOWN —
 * and is never rendered as "not installed" (served policy
 * `verification-and-evidence` `silent-empty-is-unknown`).
 */

import { OPERATIONS_API } from "@/components/operations/utils";
import { absoluteTime } from "@/components/console/time";
import { httpClient } from "@/services/service-factory";

/**
 * Coord's envelope for `GET /coord/onboarding/pending-installations`, passed
 * through verbatim by `GET /api/v1/operations/pr-merge/onboarding/pending-installation`.
 */
export interface PendingInstallationResponse {
  /** `true` = seen and unclaimed; `false` = claimed or never seen; `null` = UNKNOWN. */
  pending: boolean | null;
  installation_id: number | null;
  account_login: string | null;
  account_type: string | null;
  repo_count: number | null;
  received_at: string | null;
  claimed_at: string | null;
  /** Set on the UNKNOWN arm: `"pending_installations_table_absent"`. */
  reason?: string;
}

/** Exactly one key — the same rule coord and the proxy enforce (400 otherwise). */
export type PendingInstallationKey =
  | { installation_id: number }
  | { account_login: string };

export type PendingInstallationKind =
  | "pending"
  | "claimed"
  | "unseen"
  | "unknown";

export interface PendingInstallationVerdict {
  kind: PendingInstallationKind;
  message: string;
}

/**
 * Fetch one pending-installation row through the web proxy.
 *
 * Throws on a non-2xx (the message carries the status) so a caller can fold
 * transport failure into the UNKNOWN arm — a 502 from coord is "couldn't
 * check", not "not installed".
 */
export async function fetchPendingInstallation(
  key: PendingInstallationKey
): Promise<PendingInstallationResponse> {
  const params = new URLSearchParams(
    "installation_id" in key
      ? { installation_id: String(key.installation_id) }
      : { account_login: key.account_login }
  );
  const res = await httpClient.fetch(
    `${OPERATIONS_API}/pr-merge/onboarding/pending-installation?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`pending-installation check failed: HTTP ${res.status}`);
  }
  return (await res.json()) as PendingInstallationResponse;
}

/** "3 repos" / "1 repo" / "an unknown number of repos" (null is not zero). */
export function formatRepoCount(count: number | null | undefined): string {
  if (count === null || count === undefined) return "an unknown number of repos";
  return `${count} ${count === 1 ? "repo" : "repos"}`;
}

/**
 * Which of the four readings a response is. Pure; total over the envelope,
 * including a malformed one (anything that is not a recognisable envelope is
 * UNKNOWN, never a confident negative).
 */
export function classifyPendingInstallation(
  resp: unknown
): PendingInstallationKind {
  if (!resp || typeof resp !== "object") return "unknown";
  const r = resp as Partial<PendingInstallationResponse>;
  if (r.pending === true) return "pending";
  if (r.pending === false) {
    return typeof r.claimed_at === "string" && r.claimed_at ? "claimed" : "unseen";
  }
  return "unknown";
}

/**
 * The connect card's inline copy for a response.
 *
 * `subject` is what the operator typed, used when coord's row carries no
 * login (the unseen and unknown arms). Coord's own `account_login` wins where
 * it is present so the rendered name is the canonical casing.
 */
export function describePendingInstallation(
  resp: unknown,
  subject: string
): PendingInstallationVerdict {
  const kind = classifyPendingInstallation(resp);
  const r = (resp ?? {}) as Partial<PendingInstallationResponse>;
  const org = r.account_login || subject;
  switch (kind) {
    case "pending":
      return {
        kind,
        message:
          `coord saw the App installed on ${org} (${formatRepoCount(r.repo_count)}) ` +
          `at ${absoluteTime(r.received_at)} — not connected to a tenant yet. Connect it.`,
      };
    case "claimed":
      return {
        kind,
        message: `${org} was already connected on ${absoluteTime(r.claimed_at)}.`,
      };
    case "unseen":
      return {
        kind,
        message: `coord has not seen an install for ${org}; install the App first.`,
      };
    case "unknown":
      return {
        kind,
        message:
          "couldn't check with coord (pending-installation table unavailable)",
      };
  }
}

/** The UNKNOWN verdict for a check that never got an answer (transport/proxy error). */
export function describePendingInstallationFailure(
  err: unknown
): PendingInstallationVerdict {
  const detail = err instanceof Error ? err.message : String(err);
  return { kind: "unknown", message: `couldn't check with coord (${detail})` };
}
