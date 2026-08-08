/**
 * The session snapshot grid reads the work-unit slug off the canonical key.
 *
 * Phase 3 of plan `2026-07-30-coord-web-plan-slug-wire-key-retirement` moved
 * this reader — declaration and render site together — from coord's legacy
 * `plan_slug` to `work_unit_slug`, and relabelled the operator-visible field
 * from "plan" to "work unit". Nothing rendered this page in a test, so the
 * whole surface rested on `tsc`, which cannot see the drift that matters here:
 * `<Field>` returns `null` on a falsy value, so a reader pointed at a key coord
 * no longer emits does not throw or blank out — the row simply vanishes from
 * the grid, and the page still looks fine. Coord drops `plan_slug` in Phase 4,
 * which is exactly when that would happen unnoticed.
 *
 * So this asserts both halves: the slug reaches the DOM, and it reaches it
 * under the new label.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: "buoyant-otter-4417" }),
}));

const resolveAgentSessionMock = vi.fn();
vi.mock("@/services/agent-sessions-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/agent-sessions-api")>();
  return {
    ...actual,
    resolveAgentSession: (...args: unknown[]) =>
      resolveAgentSessionMock(...args),
  };
});

// Not under test — each opens its own coord read (or an SSE stream) on mount.
vi.mock("@/components/sessions/ResumePanel", () => ({
  ResumePanel: () => null,
}));
vi.mock("@/components/sessions/TranscriptPane", () => ({
  TranscriptPane: () => null,
}));
vi.mock("@/components/sessions/LiveTailPane", () => ({
  LiveTailPane: () => null,
}));

import SessionDetailPage from "./page";
import type { SessionCard } from "@/services/agent-sessions-api";

const SLUG = "2026-07-30-coord-web-plan-slug-wire-key-retirement";

function card(
  snapshot: Partial<
    NonNullable<NonNullable<SessionCard["working_on"]>["session"]>
  > = {},
): SessionCard {
  return {
    id: "8f1b0b3e-0f4a-4b5c-9d2e-1a2b3c4d5e6f",
    name: "buoyant-otter-4417",
    label: null,
    derived_name: "buoyant-otter-4417",
    user_id: null,
    device_id: null,
    first_seen: "2026-08-08T10:00:00Z",
    last_seen: "2026-08-08T11:00:00Z",
    closed_at: null,
    status: "live",
    machine: null,
    summary: null,
    working_on: {
      session: {
        intent_purpose: "wire-key retirement Phase 3",
        work_unit_slug: SLUG,
        correlation_topic: null,
        repo: "qontinui/qontinui-web",
        branch: "wire-key-retirement-phase3",
        provider: null,
        session_kind: null,
        state: null,
        ...snapshot,
      },
      commits: [],
      lineage: [],
    },
  };
}

describe("SessionDetailPage — work-unit slug field", () => {
  beforeEach(() => {
    resolveAgentSessionMock.mockReset();
  });

  it("renders the snapshot's work_unit_slug under the 'work unit' label", async () => {
    resolveAgentSessionMock.mockResolvedValue({
      resolved: [card()],
      count: 1,
    });

    render(<SessionDetailPage />);

    const label = await screen.findByText("work unit");
    // Pair label to value rather than asserting both exist somewhere: the grid
    // is eight sibling <dt>/<dd> pairs, so "the slug is on the page" would
    // still pass with the slug rendered under `purpose`.
    expect(label.tagName).toBe("DT");
    expect(label.nextElementSibling).toHaveTextContent(SLUG);
    // The retired vocabulary is gone from the grid, not merely deprioritized.
    expect(screen.queryByText("plan")).not.toBeInTheDocument();
  });

  it("omits the row entirely when coord reports no linked work unit", async () => {
    resolveAgentSessionMock.mockResolvedValue({
      resolved: [card({ work_unit_slug: null })],
      count: 1,
    });

    render(<SessionDetailPage />);

    // The sibling fields still render, so this is a per-field omission and not
    // a failed load masquerading as one.
    await waitFor(() =>
      expect(screen.getByText("wire-key retirement Phase 3")).toBeInTheDocument(),
    );
    expect(screen.queryByText("work unit")).not.toBeInTheDocument();
  });
});
