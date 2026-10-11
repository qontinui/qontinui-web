/**
 * `POST /pr-merge/onboarding/claim` — the browser-side GitHub App connect
 * claim, which the onboarding-status page fires once per callback arrival.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` with its
 * URL inline. Unlike the other modules it does NOT reject on a non-2xx: the
 * caller classifies the refusal from BOTH the status and the parsed error body
 * (`isRecoverableClaimRejection`, `messageForClaimError`), so the answer comes
 * back as data. A body that does not parse is `{}`. A network failure still
 * rejects. Never re-sent on a 5xx (`idempotent: false`): the claim code is
 * single-use.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** What the claim route answered, whatever the status. */
export interface OnboardingClaimAnswer {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function postOnboardingClaim(
  claim: Record<string, unknown>
): Promise<OnboardingClaimAnswer> {
  const url = `${OPERATIONS_BASE}/pr-merge/onboarding/claim`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(claim),
    idempotent: false,
  });
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  return { ok: res.ok, status: res.status, body };
}
