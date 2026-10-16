/**
 * The page-level read failure on the coord console pages that use the glossary
 * renders a refusal envelope through `BackendErrorMessage`, structured.
 *
 * Plan `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`
 * C3/D3 (web#1863) put `GlossaryTerm` on /gates, /findings, /work-units,
 * /policies and /git-ops. Their "Failed to load" banners were left printing
 * `e.message`, which for a typed-client rejection is
 * `GET <url> failed: <status> - <raw body>`. A coord refusal therefore showed
 * as a JSON dump, with no sentence, no next action and no glossary terms.
 * `operationsErrorReading` recovers the envelope from that rejection, and the
 * banner renders it. Each test asserts `data-refusal="structured"` and the
 * rendered sentence. A banner that went back to `e.message` would lose both,
 * and the raw-JSON assertion would catch it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const REFUSAL = {
  code: "workspace_root_unresolved",
  next_action: { kind: "set_setting", target: "workspace_root" },
  glossary_terms: ["tenant"],
  observed_at: "2026-09-29T00:00:00Z",
  source: "web_backend",
};

/** `Refusal::render()` for {@link REFUSAL} — the Rust test
 * `render_is_the_table_projection`. */
const RENDERED =
  'No workspace folder could be found for this operation. Set the "workspace_root" setting, then try again.';

const BODY = JSON.stringify({
  error: "workspace_root_unresolved",
  refusal: REFUSAL,
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Every read the pages make is refused with the same 409 envelope: the typed
// `/operations` client goes through `httpClient.fetch` + `readJson`, and
// `adminDevService` (the /gates overview) through `httpClient.get`, which
// rejects in the same `<VERB> <url> failed: <status> - <body>` shape.
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async () =>
      new Response(BODY, {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    get: async (url: string) => {
      throw new Error(`GET ${url} failed: 409 - ${BODY}`);
    },
    post: async (url: string) => {
      throw new Error(`POST ${url} failed: 409 - ${BODY}`);
    },
  },
}));

// The pages' own children and side reads are out of scope: only the page's
// load banner is under test.
vi.mock("./gates/_components/SummaryCards", () => ({
  SummaryCards: () => null,
}));
vi.mock("./gates/_components/GatesTable", () => ({ GatesTable: () => null }));
vi.mock("./gates/_components/RolloutPanel", () => ({
  RolloutPanel: () => null,
}));
vi.mock("./gates/_components/ShadowReap", () => ({
  ShadowReapGroups: () => null,
}));
vi.mock("./work-units/usePlanDifficulty", () => ({
  usePlanDifficulty: () => ({
    index: { state: "pending" },
    refresh: () => Promise.resolve(),
  }),
}));
vi.mock("./policies/_components/DesignPoliciesSection", () => ({
  DesignPoliciesSection: () => null,
}));

import CoordGatesPage from "./gates/page";
import CoordFindingsPage from "./findings/page";
import CoordWorkUnitsListPage from "./work-units/page";
import CoordPoliciesPage from "./policies/page";
import CoordGitOpsPage from "./git-ops/page";

async function expectStructuredBanner(testId: string) {
  const banner = await screen.findByTestId(testId);
  await waitFor(() =>
    expect(banner.querySelector('[data-refusal="structured"]')).not.toBeNull()
  );
  const root = banner.querySelector('[data-refusal="structured"]')!;
  expect(root.getAttribute("data-refusal-code")).toBe(
    "workspace_root_unresolved"
  );
  expect(root.getAttribute("data-refusal-next-action")).toBe("set_setting");
  expect(root.querySelector("[data-refusal-sentence]")?.textContent).toBe(
    RENDERED
  );
  expect(root.querySelector('[data-glossary-term="tenant"]')).not.toBeNull();
  // The raw body is never shown.
  expect(banner.textContent).not.toContain('"refusal"');
  expect(banner.textContent).not.toContain("failed: 409");
}

describe("coord console load banners render a refusal envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/gates", async () => {
    render(<CoordGatesPage />);
    await expectStructuredBanner("gates-error");
  });

  it("/findings", async () => {
    render(<CoordFindingsPage />);
    await expectStructuredBanner("coord-findings-error");
  });

  it("/work-units", async () => {
    render(<CoordWorkUnitsListPage />);
    await expectStructuredBanner("coord-work-units-error");
  });

  it("/policies", async () => {
    render(<CoordPoliciesPage />);
    await expectStructuredBanner("coord-policies-error");
  });

  it("/git-ops", async () => {
    render(<CoordGitOpsPage />);
    await expectStructuredBanner("coord-git-ops-error");
  });
});
