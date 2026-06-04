/**
 * Hermetic-lane route stubs — prod-empty parity for upstreams that do not
 * exist inside the CI job.
 *
 * Since the hermetic Spec CI stack (spec-ci.yml 2026-06-04), the backend runs
 * locally with NO qontinui-coord, NO strategy bridge, and NO real Cognito
 * admin API. The backend (correctly) surfaces those absent upstreams as
 * gateway errors: coord-proxied endpoints 502, the disabled strategy bridge
 * 503s, Cognito-admin-backed identity reads 502. Layout-level components poll
 * several of these on EVERY page, so without intervention every route accrues
 * same-origin 5xx (the serverClean gate) and some pages render error states
 * instead of their authored structure.
 *
 * The IR specs were authored against the EMPTY ci-bot account on prod, where
 * these same endpoints returned 2xx with empty payloads (verified from the
 * last green prod-lane report: none of these URLs appear among its notable
 * responses, and all 62 specs full-matched). These stubs reproduce exactly
 * those responses — same status, same wire shape, zero rows — so the page
 * renders its authored empty state deterministically.
 *
 * Scope discipline:
 *   - GET only; any other method falls through to the real backend.
 *   - Patterns are anchored RegExps over the URL path — list endpoints only;
 *     sub-resources (`/devices/{id}/…`, `/strategy/docs/{name}`) fall through.
 *   - Applied ONLY when `QONTINUI_TEST_ID_TOKEN` is set (the hermetic-lane
 *     marker) — non-hermetic runs (manual `--api-base <real>`) are untouched.
 *   - Every entry documents the wire-shape source. A wrong shape is loud: it
 *     surfaces as a critical console error (TypeError in the consumer), which
 *     the console gate reds.
 *
 * This file is the hermetic twin of `crawl-baseline.ts`'s
 * GLOBAL_SERVER_WAIVERS `ci-env` class: where a waiver tolerates a 5xx the
 * page cannot avoid, a stub removes the 5xx entirely AND restores the
 * authored render — strictly stronger, so these endpoints need no waivers.
 */

import type { BrowserContext } from "@playwright/test";

export interface HermeticStub {
  /** Anchored against the URL path (query excluded by the trailing group). */
  pattern: RegExp;
  /** JSON body to fulfill with (status 200). */
  body: unknown;
  /** Wire-shape source, for review + drift triage. */
  note: string;
}

export const HERMETIC_STUBS: readonly HermeticStub[] = [
  {
    pattern: /\/api\/v1\/devices(\?|$)/,
    body: [],
    note: "list[RunnerWire] (endpoints/devices.py:249 response_model) — coord fleet proxy; ci-bot owned no devices on prod",
  },
  {
    pattern: /\/api\/v1\/operations\/tenants(\?|$)/,
    body: { tenants: [], active_tenant_id: "" },
    note: "TenantListResponse (components/sessions/types.ts:135) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/device-status(\?|$)/,
    body: { devices: [], count: 0 },
    note: "DeviceStatusResponse (components/operations/types.ts:54) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/merge\/queue(\?|$)/,
    body: { proposals: [] },
    note: "QueueResponse {proposals} (operations/mergeTypes.ts; MergeTrain.tsx:498 tolerates either shape) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/symbol-claims(\?|$)/,
    body: { kind: "symbol", prefix: "", holders: [], truncated: false },
    note: "SymbolClaimsResponse (components/operations/types.ts:90) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/sessions(\?|$)/,
    body: { sessions: [] },
    note: "{sessions: SessionRow[]} (components/sessions/types.ts:57) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/repos(\?|$)/,
    body: { repos: [] },
    note: "RegisteredReposResponse (components/sessions/types.ts:131) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/coord\/next-step-settings(\?|$)/,
    body: { settings: null },
    note: "{settings: NextStepSettings|null} (settings/coordination/_hooks/useNextStepSettings.ts) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/pr-merge\/prs(\?|$)/,
    body: [],
    note: "MergeTrain fetchPrs tolerates bare array — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/pr-merge\/escalations(\?|$)/,
    body: [],
    note: "MergeTrain fetchEscalations tolerates bare array (MergeTrain.tsx:526) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/pr-merge\/suggestions(\?|$)/,
    body: [],
    note: "MergeTrain fetchSuggestions tolerates bare array (MergeTrain.tsx:596) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/strategy\/mentions\/unread(\?|$)/,
    body: { items: [] },
    note: "coord list_unread_mentions wire {items} (lib/api/strategy.ts:215) — strategy bridge disabled in CI",
  },
  {
    pattern: /\/api\/v1\/strategy\/docs(\?|$)/,
    body: { docs: [] },
    note: "{docs: StrategyDocSummary[]} (lib/api/strategy.ts:107) — strategy bridge disabled in CI",
  },
  {
    pattern: /\/api\/v1\/auth\/identities(\?|$)/,
    body: { identities: [] },
    note: "{identities: LinkedIdentity[]} (lib/api/identities.ts:38) — Cognito admin API absent in CI",
  },
];

/**
 * Install the hermetic stubs on a BrowserContext. No-op teardown burden:
 * contexts are run-scoped, so callers never need to unroute.
 */
export async function applyHermeticStubs(ctx: BrowserContext): Promise<void> {
  for (const stub of HERMETIC_STUBS) {
    await ctx.route(stub.pattern, (route) => {
      if (route.request().method() !== "GET") {
        void route.fallback();
        return;
      }
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stub.body),
      });
    });
  }
}
