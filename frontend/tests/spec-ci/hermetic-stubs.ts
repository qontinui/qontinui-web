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
 * The IR specs were authored against the ci-bot account on prod, where these
 * same endpoints returned 2xx (verified from the last green prod-lane report:
 * none of these URLs appear among its notable responses, and all 62 specs
 * full-matched). These stubs reproduce PROD PARITY for that account — empty
 * payloads for per-account data (ci-bot owned nothing), populated payloads
 * where prod content is tenant-global (the strategy corpus, the active
 * tenant row) — so each page renders its authored state deterministically.
 *
 * Scope discipline:
 *   - GET only; any other method falls through to the real backend.
 *   - Patterns are anchored RegExps over the URL path — un-stubbed
 *     sub-resources (`/devices/{id}/…`) fall through to the real backend.
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
  /**
   * JSON body to fulfill with (status 200), or a function of the matched URL
   * for stubs whose body depends on the path (e.g. strategy doc content).
   */
  body: unknown | ((url: string) => unknown);
  /** Wire-shape source, for review + drift triage. */
  note: string;
}

/** Stable synthetic tenant id — referenced by both tenants-stub fields. */
const SPEC_CI_TENANT_ID = "a0000000-0000-4000-8000-0000005bec01";

/**
 * Strategy corpus doc summaries — the strategy page's document nav renders
 * one link per doc (`link-<name>`), and the spec asserts the SPECIFIC corpus
 * doc links it was authored against (strategy spec document-nav elems). The
 * corpus is tenant-global content served via the coord strategy bridge, so
 * prod-parity here is POPULATED, not empty — these are the six docs the spec
 * names.
 */
const STRATEGY_DOCS = [
  { name: "project-strategy", title: "Project Strategy" },
  {
    name: "load-bearing-architectural-decisions",
    title: "Load-Bearing Architectural Decisions",
  },
  { name: "business-goals", title: "Business Goals" },
  { name: "customer-context", title: "Customer Context" },
  { name: "human-preferences", title: "Human Preferences" },
  { name: "strategic-priorities", title: "Strategic Priorities" },
].map((d) => ({
  ...d,
  provenance: {
    commit_sha: "0000000000000000000000000000000000000000",
    committed_at: "2026-01-01T00:00:00Z",
    author: "spec-ci",
  },
}));

/** Title-case a doc slug for the synthetic doc-content stub. */
function docTitle(name: string): string {
  const known = STRATEGY_DOCS.find((d) => d.name === name);
  if (known) return known.title;
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const HERMETIC_STUBS: readonly HermeticStub[] = [
  {
    pattern: /\/api\/v1\/devices(\?|$)/,
    body: [],
    note: "list[RunnerWire] (endpoints/devices.py:249 response_model) — coord fleet proxy; ci-bot owned no devices on prod",
  },
  {
    pattern: /\/api\/v1\/operations\/tenants(\?|$)/,
    // One synthetic tenant, ACTIVE — prod ci-bot resolves exactly one tenant,
    // and the settings identity section renders its Tenant / Tenant ID label
    // rows only when the active tenant resolves (settings spec
    // identity-fields-elem-2/3). One row keeps isMultiTenant=false, matching
    // the authored single-tenant render.
    body: {
      tenants: [{ id: SPEC_CI_TENANT_ID, slug: "spec-ci", name: "Spec CI" }],
      active_tenant_id: SPEC_CI_TENANT_ID,
    },
    note: "TenantListResponse (components/sessions/types.ts:135) — coord proxy; populated to prod-parity (1 active tenant)",
  },
  {
    pattern: /\/api\/v1\/operations\/device-status(\?|$)/,
    body: { devices: [], count: 0 },
    note: "DeviceStatusResponse (components/operations/types.ts:54) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/gates\/list(\?|$)/,
    // Bare array — coord's GET /coord/gates serializes Vec<GateResponse>;
    // useGatesStream.ts:35 tolerates bare array or {gates: []}. Empty list
    // drives the panel's "No gates registered" empty state, which the
    // operations spec's operations-gates-panel state asserts.
    body: [],
    note: "GateRow[] (components/operations/useGatesStream.ts:23) — coord proxy; gates panel empty state",
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
    // Wire is the NextStepSettings object DIRECTLY (httpClient.get
    // <NextStepSettings> in useNextStepSettings.ts:89), not {settings: ...}
    // — the wrapped shape threw `settings.domains.some` TypeErrors on
    // /settings/coordination (iteration-2 crawl finding).
    body: { domains: [] },
    note: "NextStepSettings {domains: []} (settings/coordination/_hooks/useNextStepSettings.ts:89) — coord proxy",
  },
  {
    pattern: /\/api\/v1\/operations\/agent-logs\/by-agent\/[^/?]+(\?|$)/,
    body: { logs: [] },
    note: "ByAgentResponse {logs} (admin/coord/agents/[agent_id]/page.tsx fetchData; tolerates bare array) — coord proxy",
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
    body: { docs: STRATEGY_DOCS },
    note: "{docs: StrategyDocSummary[]} (lib/api/strategy.ts:107) — strategy bridge disabled in CI; populated to prod-parity (corpus is tenant-global)",
  },
  {
    pattern: /\/api\/v1\/strategy\/docs\/[^/?]+(\?|$)/,
    // The strategy page auto-loads the first doc into the viewer; the spec
    // asserts the doc H1 plus the `## Files` / `## Update Protocol` section
    // headings every corpus doc carries.
    body: (url: string) => {
      const name = decodeURIComponent(
        url.split("/strategy/docs/")[1]?.split("?")[0] ?? "doc",
      );
      return {
        name,
        title: docTitle(name),
        provenance: STRATEGY_DOCS[0].provenance,
        content: `# ${docTitle(name)}\n\nSpec CI synthetic corpus doc.\n\n## Files\n\n- (none — hermetic stub)\n\n## Update Protocol\n\nStub content for the authored viewer baseline.\n`,
      };
    },
    note: "StrategyDoc {…, content} (lib/api/strategy.ts:33) — doc content for the auto-loaded viewer",
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
      const body =
        typeof stub.body === "function"
          ? (stub.body as (url: string) => unknown)(route.request().url())
          : stub.body;
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }
}
