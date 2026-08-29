/**
 * D5 — the two detail halves merge, and NEITHER is dropped.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md`. Until Phase 2, each
 * shipped detail view carried half the answer: `/sessions/[id]` had
 * coordination, PTY output, lineage and steal/handoff and no transcript or
 * resume; `/environments/sessions/[key]` had the transcript, the live tail and
 * the resume capability and none of the coordination half. This file asserts
 * both halves are on one page — and, just as load-bearing, that a MISSING half
 * is reported as the structural thing it is rather than as a fault.
 *
 * `SessionDetail` is stubbed (its internals have their own coverage; what is
 * under test is whether it is mounted at all). `ResumePanel` is NOT stubbed:
 * `resume-capability-badge` is a frozen testid and the badge is the honesty
 * contract this phase must carry forward verbatim, so it renders for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { SessionsApiError } from "./api";
import type { SessionCard } from "@/services/agent-sessions-api";
import type { SessionRow } from "./types";

vi.mock("./SessionDetail", () => ({
  SessionDetail: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="stub-session-detail" data-session-id={sessionId} />
  ),
}));

vi.mock("@/services/devenv-api", () => ({
  listMachines: vi.fn(async () => []),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    // The panes fetch on mount. None of them is what this file is about.
    getSessionRestoreRecord: vi.fn(async () => ({
      session_id: "s",
      record: null,
      events: [],
    })),
    getSessionOutput: vi.fn(async () => ({
      session_id: "s",
      tier: "warm",
      chunks: [],
      count: 0,
    })),
    subscribeSessionOutput: vi.fn(() => () => {}),
    subscribeSessionEvents: vi.fn(() => () => {}),
  };
});

import { ConsolidatedSessionDetail } from "./ConsolidatedSessionDetail";

const CARD: SessionCard = {
  id: "agent-1",
  name: "brave-otter",
  label: "brave-otter",
  derived_name: "brave-otter",
  user_id: null,
  device_id: "dev-a",
  first_seen: "2026-08-26T11:00:00Z",
  last_seen: "2026-08-26T11:50:00Z",
  closed_at: null,
  status: "live",
  machine: null,
  summary: "shipping the console",
  working_on: null,
};

const LIFECYCLE_ROW = {
  id: "agent-1",
  tenant_id: "t",
  device_id: "dev-a",
  session_kind: "terminal_claude",
  intent: { purpose: "ship" },
  state: "active",
  started_at: null,
  last_heartbeat_at: null,
  closed_at: null,
  parent_session_id: null,
  repo: null,
  branch: null,
  provider: "claude",
  claude_code_session_id: "agent-1",
} as SessionRow;

function mount(
  over: Partial<React.ComponentProps<typeof ConsolidatedSessionDetail>> = {}
) {
  const listArtifacts = vi.fn(async () => ({
    items: [],
    total: 0,
    offset: 0,
    limit: 10,
  }));
  const readOutput = vi.fn(async () => ({
    session_id: "s",
    tier: "warm",
    chunks: [],
    count: 0,
  }));
  render(
    <ConsolidatedSessionDetail
      card={CARD}
      sessionId="agent-1"
      fetchSession={(async () => LIFECYCLE_ROW) as never}
      readOutput={readOutput as never}
      listArtifacts={listArtifacts as never}
      {...over}
    />
  );
  return { listArtifacts, readOutput };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("D5 — nine sections, both halves, one page", () => {
  it("mounts the twin card AND the coordination half together", async () => {
    mount();
    // The half `/sessions/[id]` never had.
    expect(await screen.findByTestId("twin-session-card")).toBeInTheDocument();
    // The half `/environments/sessions/[key]` never had.
    expect(
      await screen.findByTestId("stub-session-detail")
    ).toHaveAttribute("data-session-id", "agent-1");
  });

  it("carries the frozen testids forward VERBATIM (trap 5)", async () => {
    mount();
    expect(await screen.findByTestId("twin-session-card")).toBeInTheDocument();
    expect(
      await screen.findByTestId("resume-capability-badge")
    ).toBeInTheDocument();
  });

  it("surfaces the resume badge's claim and does not upgrade it", async () => {
    mount();
    const badge = await screen.findByTestId("resume-capability-badge");
    // No restore record in the stub ⇒ the badge's own honest floor. Nothing
    // here may promise a conversation resume the record does not support.
    expect(badge).toHaveTextContent(/Not resumable from this machine/i);
    expect(badge.textContent).not.toMatch(/full \(conversation/i);
  });

  it("shows BOTH transcript stores beside each other, labelled", async () => {
    mount();
    const stores = await screen.findByTestId("session-transcript-stores");
    expect(
      screen.getByTestId("session-transcript-live")
    ).toHaveTextContent(/coord/i);
    expect(
      screen.getByTestId("session-transcript-archive")
    ).toHaveTextContent(/Permanent/i);
    expect(stores).toHaveTextContent(/7 days/i);
  });

  it("looks the archive up by the card's Claude session id", async () => {
    const { listArtifacts } = mount();
    await waitFor(() =>
      expect(listArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({ claudeSessionId: "agent-1" })
      )
    );
  });
});

describe("D2 — a missing half is structural, not a fault", () => {
  it("a 404 lifecycle read says NOT APPLICABLE, never 'unavailable'", async () => {
    mount({
      fetchSession: (async () => {
        throw new SessionsApiError("GET /sessions/x failed: 404", 404);
      }) as never,
    });
    const notice = await screen.findByTestId(
      "consolidated-session-lifecycle-absent"
    );
    expect(notice).toHaveTextContent(/not applicable/i);
    expect(notice).toHaveTextContent(/not a heartbeat that stopped/i);
    expect(notice.textContent).not.toMatch(/\bclosed\b|\bfalse\b|^0$/i);
    expect(screen.queryByTestId("stub-session-detail")).toBeNull();
  });

  it("a failed lifecycle read says UNKNOWN, and does not claim absence", async () => {
    mount({
      fetchSession: (async () => {
        throw new SessionsApiError("GET /sessions/x failed: 502", 502);
      }) as never,
    });
    const notice = await screen.findByTestId(
      "consolidated-session-lifecycle-unknown"
    );
    expect(notice).toHaveTextContent(/unknown/i);
    expect(notice).toHaveTextContent(/did not land/i);
    expect(notice.textContent).not.toMatch(/not applicable/i);
    expect(screen.queryByTestId("stub-session-detail")).toBeNull();
  });

  it("renders a lifecycle-only session with no card at all", async () => {
    mount({ card: null, sessionId: "life-1" });
    const notice = await screen.findByTestId(
      "consolidated-session-agent-half-absent"
    );
    expect(notice).toHaveTextContent(/not applicable here/i);
    expect(notice.textContent).not.toMatch(/\bno transcript\b\.?$/i);
    // The permanent archive is still asked — by the OTHER id space.
    expect(screen.getByTestId("session-transcript-stores")).toBeInTheDocument();
    expect(screen.queryByTestId("twin-session-card")).toBeNull();
  });

  it("uses the coord id for the archive lookup when there is no card", async () => {
    const { listArtifacts } = mount({ card: null, sessionId: "life-1" });
    await waitFor(() =>
      expect(listArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({ coordSessionId: "life-1" })
      )
    );
  });
});
