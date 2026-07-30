/**
 * SessionComplianceSection — the operator control surface for the session
 * compliance check (plan
 * `2026-07-30-session-compliance-report-enforcement.md` §B2/§B3).
 *
 * These pin the claims the surface is only allowed to make if they are true,
 * because every one of them is a place where a plausible-looking UI would lie:
 *
 * - **Coord not serving the routes yet must not render as an empty result.**
 *   The routes 404 until coord's half of the plan ships; an empty table would
 *   assert "no sessions have been checked", which we do not know.
 * - **Applicability is derived and rendered as such**, including the
 *   `clause_absent` case, where a failed lookup and a genuinely-removed clause
 *   must be distinguishable — a false `clause_absent` silently disables the
 *   whole mechanism.
 * - **The coverage bound is stated.** The runner sees only sessions it spawned;
 *   a page implying universal coverage is the exact failure the architecture
 *   change was made to avoid.
 * - **Three verdicts, never four.** A missing report is unverified-with-reason,
 *   not a separate state.
 * - **A guessed gate attribution is never shown as a confirmed one.**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SessionComplianceSection } from "./SessionComplianceSection";

const CONFIG = {
  enabled: true,
  mode: "nudge" as const,
  max_attempts: 1,
  enforced_clause_ref: "policy/planning-and-scope#finish-to-zero",
  applicable: true,
  applicability_reason: "applicable" as const,
  clause_resolved_via: "registry" as const,
  prompt_document_version: 7,
  current_version: 3,
};

/** Route the four independent GETs by URL, the way the hook issues them. */
function routeGets(overrides: Record<string, unknown> = {}) {
  getMock.mockImplementation((url: string) => {
    if (url.includes("/config/versions"))
      return Promise.resolve(overrides.versions ?? { versions: [] });
    if (url.includes("/config"))
      return Promise.resolve(overrides.config ?? CONFIG);
    if (url.includes("/sessions"))
      return Promise.resolve(overrides.sessions ?? { sessions: [] });
    if (url.includes("/outstanding"))
      return Promise.resolve(overrides.outstanding ?? { items: [] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe("SessionComplianceSection", () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
  });

  it("says coord doesn't serve the routes yet rather than showing an empty result", async () => {
    getMock.mockRejectedValue(
      new Error("GET /api/v1/operations/... failed: 404 - Not Found")
    );

    render(<SessionComplianceSection />);

    const notice = await screen.findByTestId("compliance-unavailable");
    // Both readings of a 404 are named — the UI reports what coord said, and
    // does not pick one diagnosis and state it as fact.
    expect(notice).toHaveTextContent(/doesn't serve the session-compliance/i);
    expect(notice).toHaveTextContent(/nothing stored under them for this tenant/i);
    // The honesty clause: absence of data is not evidence of absence of work.
    expect(notice).toHaveTextContent(
      /not the same as nothing having happened/i
    );
  });

  it("renders the enforcement panel with derived applicability", async () => {
    routeGets();

    render(<SessionComplianceSection />);

    const applicability = await screen.findByTestId("compliance-applicability");
    expect(applicability).toHaveTextContent("Currently applicable: yes");
    expect(applicability).toHaveTextContent(/worked out by coord, not set here/i);
    expect(applicability).toHaveTextContent("version 7");
    expect(screen.getByTestId("clause-resolved-via")).toHaveTextContent(
      /matched a structured clause row/i
    );
  });

  it("distinguishes an unresolved clause lookup from a removed clause", async () => {
    routeGets({
      config: {
        ...CONFIG,
        applicable: false,
        applicability_reason: "clause_absent",
        clause_resolved_via: null,
      },
    });

    render(<SessionComplianceSection />);

    const applicability = await screen.findByTestId("compliance-applicability");
    expect(applicability).toHaveTextContent("Currently applicable: no");
    expect(applicability).toHaveTextContent(/not in the active version/i);
    expect(screen.getByTestId("clause-resolved-via")).toHaveTextContent(
      /no clause row and no clause heading matched/i
    );
    // The trap this exists for: an unresolved lookup disables the mechanism as
    // quietly as a deleted clause, so the panel must not let them look alike.
    expect(screen.getByTestId("clause-resolved-via")).toHaveTextContent(
      /before assuming the clause was removed/i
    );
  });

  it("states the coverage bound instead of implying universal coverage", async () => {
    routeGets();

    render(<SessionComplianceSection />);

    const bound = await screen.findByTestId("compliance-coverage-bound");
    expect(bound).toHaveTextContent(/sessions started from this runner/i);
    expect(bound).toHaveTextContent(/external terminal/i);
    expect(bound).toHaveTextContent(/another machine/i);
    expect(bound).toHaveTextContent(/different runner instance/i);
  });

  it("renders a missing report as unverified with a reason, not a fourth state", async () => {
    routeGets({
      sessions: {
        sessions: [
          {
            id: "sc-1",
            claude_session_id: "sess-absent",
            verdict: "unverified",
            reason: "absent",
            report: null,
            reconciliation: { reason: "absent" },
            checked_at: "2026-07-30T12:00:00Z",
            finalized: true,
          },
        ],
      },
    });

    render(<SessionComplianceSection />);

    const row = await screen.findByTestId("compliance-session-sess-absent");
    expect(within(row).getByText("Unverified")).toBeInTheDocument();
    expect(within(row).getByText(/no report emitted/i)).toBeInTheDocument();
  });

  it("marks a still-running session's verdict as not final", async () => {
    routeGets({
      sessions: {
        sessions: [
          {
            id: "sc-2",
            claude_session_id: "sess-live",
            verdict: "unverified",
            report: { items: [] },
            reconciliation: { items: [], unreconciled_count: 2 },
            checked_at: "2026-07-30T12:00:00Z",
            finalized: false,
          },
        ],
      },
    });

    render(<SessionComplianceSection />);

    const row = await screen.findByTestId("compliance-session-sess-live");
    expect(within(row).getByTestId("verdict-in-progress")).toHaveTextContent(
      /not final/i
    );
    expect(within(row).getByText("2")).toBeInTheDocument();
  });

  it("labels a guessed gate attribution as guessed in the outstanding ledger", async () => {
    routeGets({
      outstanding: {
        items: [
          {
            claude_session_id: "sess-3",
            checked_at: "2026-07-30T12:00:00Z",
            ref: "A3 session-scoped gates",
            state: "gated",
            gate_id: "gate-123",
            gate_status: "open",
            attribution: "heuristic",
          },
          {
            claude_session_id: "sess-3",
            checked_at: "2026-07-29T12:00:00Z",
            ref: "docs follow-up",
            state: "deferred",
            reason: "out of scope for this PR",
          },
        ],
      },
    });

    render(<SessionComplianceSection />);

    const ledger = await screen.findByTestId("outstanding-ledger");
    expect(within(ledger).getByText("Guessed, not proven")).toBeInTheDocument();
    // The gate is a real link to the gate, not just to the gates list.
    expect(
      within(ledger).getByTestId("outstanding-gate-link-gate-123")
    ).toHaveAttribute("href", "/admin/coord/gates?gate=gate-123");
    // A deferred item shows its stated reason instead of a gate.
    expect(
      within(ledger).getByText(/out of scope for this PR/i)
    ).toBeInTheDocument();
  });

  it("never claims the settings are untouched off a history route it couldn't read", async () => {
    const user = userEvent.setup();
    // Only the versions route fails — the staged-rollout case that
    // `featureUnavailable` (all four 404) does not rescue.
    getMock.mockImplementation((url: string) => {
      if (url.includes("/config/versions"))
        return Promise.reject(new Error("GET x failed: 404 - Not Found"));
      if (url.includes("/config")) return Promise.resolve(CONFIG);
      if (url.includes("/sessions")) return Promise.resolve({ sessions: [] });
      return Promise.resolve({ items: [] });
    });

    render(<SessionComplianceSection />);

    await user.click(
      await screen.findByTestId("compliance-config-history-toggle")
    );

    const history = await screen.findByTestId("compliance-config-history");
    expect(
      within(history).getByTestId("compliance-unavailable")
    ).toBeInTheDocument();
    // The positive claim about tenant state must NOT appear.
    expect(
      within(history).queryByText(/No recorded changes yet/i)
    ).not.toBeInTheDocument();
  });

  it("does not infer 'no report emitted' from a list row that omits the report", async () => {
    routeGets({
      sessions: {
        sessions: [
          {
            id: "sc-4",
            claude_session_id: "sess-omitted",
            verdict: "unverified",
            // No `report`, and coord said nothing about absence — the list
            // projection simply may not carry the body.
            reconciliation: { unreconciled_count: 1 },
            checked_at: "2026-07-30T12:00:00Z",
          },
        ],
      },
    });

    render(<SessionComplianceSection />);

    const row = await screen.findByTestId("compliance-session-sess-omitted");
    expect(within(row).getByText("Unverified")).toBeInTheDocument();
    expect(
      within(row).queryByText(/no report emitted/i)
    ).not.toBeInTheDocument();
  });

  it("never badges a guessed-attribution claim as confirmed", async () => {
    routeGets({
      outstanding: {
        items: [
          {
            claude_session_id: "sess-5",
            checked_at: "2026-07-30T12:00:00Z",
            ref: "gated thing",
            state: "gated",
            gate_id: "gate-9",
            attribution: "heuristic",
            result: "confirmed",
          },
        ],
      },
    });

    render(<SessionComplianceSection />);

    const ledger = await screen.findByTestId("outstanding-ledger");
    expect(within(ledger).queryByText("Confirmed")).not.toBeInTheDocument();
    expect(
      within(ledger).getByText(/Confirmed — attribution guessed/)
    ).toBeInTheDocument();
  });

  it("explains what the check is, including who runs it", async () => {
    routeGets();

    render(<SessionComplianceSection />);

    const panel = await screen.findByTestId("compliance-enforcement-panel");
    expect(panel).toHaveTextContent(/POLICY_COMPLIANCE report/);
    expect(panel).toHaveTextContent(/the runner runs the check/i);
    expect(panel).toHaveTextContent(/coord reconciles and stores/i);
    // The two honest bounds on what the check proves.
    expect(panel).toHaveTextContent(/cannot prove a session read your policy/i);
    expect(panel).toHaveTextContent(/checked for shape only/i);
  });
});
