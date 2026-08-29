/**
 * `/sessions/[key]` — D4's resolver, at the page.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` §8's bar: *"the `[key]`
 * resolver renders `count > 1` as multiple cards"*. Four things are pinned
 * here and every one of them is a way the page could quietly lie:
 *
 * 1. an ambiguous NAME renders EVERY match, not `resolved[0]`;
 * 2. a key only the OTHER id space knows still renders;
 * 3. a read that did not land is UNKNOWN, never "no such session";
 * 4. the literal `repository` is a route, and coord is never asked about it.
 *
 * `ConsolidatedSessionDetail` is stubbed: this file is about which matches
 * reach it, not about what it renders. Its own composition is covered beside
 * it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AgentSessionsApiError } from "@/services/agent-sessions-api";
import { SessionsApiError } from "@/components/sessions/api";
import type { SessionCard } from "@/services/agent-sessions-api";

let mockKey = "brave-otter";

vi.mock("next/navigation", () => ({
  useParams: () => ({ key: mockKey }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));

vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({ byHostname: new Map() }),
}));

const resolveAgentSession = vi.fn();
vi.mock("@/services/agent-sessions-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/agent-sessions-api")
  >();
  return {
    ...actual,
    resolveAgentSession: (key: string) => resolveAgentSession(key),
  };
});

const getSession = vi.fn();
vi.mock("@/components/sessions/api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/sessions/api")
  >();
  return {
    ...actual,
    getSession: (id: string, signal?: AbortSignal) => getSession(id, signal),
  };
});

vi.mock("@/components/sessions/ConsolidatedSessionDetail", () => ({
  ConsolidatedSessionDetail: ({
    sessionId,
    card,
  }: {
    sessionId: string;
    card: { derived_name?: string } | null;
  }) => (
    <div data-testid="stub-detail" data-session-id={sessionId}>
      {card ? "card" : "lifecycle-only"}
    </div>
  ),
}));

import SessionKeyPage from "./page";

function card(id: string): SessionCard {
  return {
    id,
    name: "brave-otter",
    label: "brave-otter",
    derived_name: "brave-otter",
    user_id: null,
    device_id: null,
    first_seen: null,
    last_seen: null,
    closed_at: null,
    status: "closed",
    machine: null,
    summary: null,
    working_on: null,
  };
}

const NOT_FOUND_AGENT = new AgentSessionsApiError(404, "no match");
const NOT_FOUND_LIFECYCLE = new SessionsApiError(
  "GET /sessions/x failed: 404",
  404
);

beforeEach(() => {
  mockKey = "brave-otter";
  resolveAgentSession.mockReset();
  getSession.mockReset();
});

describe("D4 — count > 1 renders EVERY match", () => {
  it("renders one detail per resolved card, newest-first", async () => {
    resolveAgentSession.mockResolvedValue({
      resolved: [card("s-3"), card("s-2"), card("s-1")],
      count: 3,
    });
    getSession.mockRejectedValue(NOT_FOUND_LIFECYCLE);

    render(<SessionKeyPage />);

    const details = await screen.findAllByTestId("stub-detail");
    expect(details).toHaveLength(3);
    expect(details.map((d) => d.getAttribute("data-session-id"))).toEqual([
      "s-3",
      "s-2",
      "s-1",
    ]);
    // And the page SAYS the key was ambiguous, rather than showing three cards
    // with no explanation.
    expect(
      screen.getByTestId("sessions-detail-ambiguous-key")
    ).toHaveTextContent(/3 sessions match this key/i);
  });

  it("does not announce ambiguity for the single-match case", async () => {
    resolveAgentSession.mockResolvedValue({
      resolved: [card("s-1")],
      count: 1,
    });
    getSession.mockRejectedValue(NOT_FOUND_LIFECYCLE);

    render(<SessionKeyPage />);
    await screen.findByTestId("stub-detail");
    expect(screen.queryByTestId("sessions-detail-ambiguous-key")).toBeNull();
  });
});

describe("both id spaces", () => {
  it("renders a key only the lifecycle half knows", async () => {
    mockKey = "life-1";
    resolveAgentSession.mockRejectedValue(NOT_FOUND_AGENT);
    getSession.mockResolvedValue({ id: "life-1", state: "active" });

    render(<SessionKeyPage />);
    const detail = await screen.findByTestId("stub-detail");
    expect(detail).toHaveTextContent("lifecycle-only");
    expect(detail).toHaveAttribute("data-session-id", "life-1");
  });

  it("asks BOTH halves — neither is a fallback for the other", async () => {
    resolveAgentSession.mockResolvedValue({ resolved: [card("s-1")], count: 1 });
    getSession.mockResolvedValue({ id: "s-1", state: "active" });

    render(<SessionKeyPage />);
    await screen.findByTestId("stub-detail");
    expect(resolveAgentSession).toHaveBeenCalledWith("brave-otter");
    expect(getSession).toHaveBeenCalled();
  });
});

describe("D2 — a failed read is not an absence", () => {
  it("says NOT FOUND only when both halves answered no", async () => {
    resolveAgentSession.mockRejectedValue(NOT_FOUND_AGENT);
    getSession.mockRejectedValue(NOT_FOUND_LIFECYCLE);

    render(<SessionKeyPage />);
    const notFound = await screen.findByTestId("sessions-detail-not-found");
    expect(notFound).toHaveTextContent(/Both id spaces answered/i);
  });

  it("says UNKNOWN when a half never answered, and refuses to claim absence", async () => {
    resolveAgentSession.mockRejectedValue(
      new AgentSessionsApiError(502, "bad gateway")
    );
    getSession.mockRejectedValue(NOT_FOUND_LIFECYCLE);

    render(<SessionKeyPage />);
    const unknown = await screen.findByTestId("sessions-detail-unknown");
    expect(unknown).toHaveTextContent(/could not be resolved/i);
    expect(unknown).toHaveTextContent(/unknown/i);
    // The not-found HEADLINE must not appear. (The unknown copy does contain
    // the words "does not exist" — inside the sentence that REFUSES the
    // claim — so a keyword ban would fail the honest string.)
    expect(unknown.textContent).not.toMatch(/No session matches this key/i);
    expect(unknown.textContent).toMatch(/not a finding that the session does not exist/i);
    expect(screen.queryByTestId("sessions-detail-not-found")).toBeNull();
  });
});

describe("trap 8 — /sessions/repository is a route, not a key", () => {
  it("refuses the literal segment WITHOUT asking coord", async () => {
    mockKey = "repository";
    render(<SessionKeyPage />);

    await waitFor(() =>
      expect(screen.getByTestId("sessions-detail-reserved")).toBeInTheDocument()
    );
    expect(resolveAgentSession).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sessions-detail-not-found")).toBeNull();
  });
});

describe("the frozen testid", () => {
  it("carries sessions.detail-page forward verbatim", async () => {
    resolveAgentSession.mockResolvedValue({ resolved: [card("s-1")], count: 1 });
    getSession.mockRejectedValue(NOT_FOUND_LIFECYCLE);

    const { container } = render(<SessionKeyPage />);
    await screen.findByTestId("stub-detail");
    expect(
      container.querySelector('[data-ui-bridge-id="sessions.detail-page"]')
    ).not.toBeNull();
  });
});
