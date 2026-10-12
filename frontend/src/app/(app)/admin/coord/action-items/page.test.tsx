/**
 * Component test for /admin/coord/action-items.
 *
 * Plan `2026-10-12-operator-action-items-pushed-to-the-phone` Phase 3. Pinned:
 *
 *  - tab counts come from the envelope's `counts`, never the page length, and
 *    read `–` before the first answer
 *  - an open item whose push did not land turns the strip red
 *  - links: https opens in a new tab, a qontinui:// route is text only
 *  - Done / Dismiss send the typed resolve body, then re-read
 *  - a resolve refusal is shown on the row
 *  - coord's 503 schema_migration_pending renders "not available yet"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
const httpPost = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (
      url: string,
      init: {
        method?: string;
        body?: string;
        idempotent?: boolean;
        [key: string]: unknown;
      } = {}
    ) => {
      const { method, body, idempotent: _idempotent, ...options } = init;
      const answer =
        method === "POST"
          ? await httpPost(url, JSON.parse(body ?? "null"), options)
          : await httpGet(url, options);
      return new Response(JSON.stringify(answer ?? null));
    },
  },
}));

import CoordActionItemsPage from "./page";

const ID_A = "c79a07d5-7e40-49b4-87fa-554c749f9644";
const ID_B = "0f4d1a2b-6c8e-4f10-9a33-2b7c5d8e1f90";

function actionItem(over: Record<string, unknown> = {}) {
  return {
    item_id: ID_A,
    title: "Route High and Medium plans to Opus",
    body: "web#1780 is deployed. Open Plan library settings.",
    links: [
      {
        label: "Plan library settings",
        url: "https://qontinui.io/admin/coord/plan-library/settings",
      },
      { label: "This item", url: `qontinui://coord/actions/${ID_A}` },
    ],
    status: "open",
    source_kind: "gate",
    source_ref: {},
    created_by: "gate:g1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    push: {
      state: "accepted",
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: null,
      detail: { accepted: 1, devices: 1 },
    },
    ...over,
  };
}

function envelope(
  items: unknown[],
  counts = { open: 7, done: 12, dismissed: 3 }
) {
  return { items, next_cursor: null, counts };
}

describe("CoordActionItemsPage", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
  });

  it("reads tab counts from the envelope, not the page length", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    render(<CoordActionItemsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("action-items-tab-open")).toHaveTextContent(
        "Open7"
      )
    );
    expect(screen.getByTestId("action-items-tab-done")).toHaveTextContent(
      "Done12"
    );
    expect(screen.getByTestId("action-items-tab-dismissed")).toHaveTextContent(
      "Dismissed3"
    );
    expect(screen.getByTestId("action-items-open-count")).toHaveTextContent(
      "open 7"
    );
    expect(String(httpGet.mock.calls[0][0])).toBe(
      "/api/v1/operations/action-items?status=open&limit=200"
    );
  });

  it("renders dashes before the first read answers", async () => {
    httpGet.mockReturnValue(new Promise(() => {}));
    render(<CoordActionItemsPage />);
    expect(screen.getByTestId("action-items-tab-open")).toHaveTextContent(
      "Open–"
    );
    expect(screen.getByTestId("action-items-open-count")).toHaveTextContent(
      "open –"
    );
  });

  it("turns the strip red when an owed item did not reach the phone", async () => {
    httpGet.mockResolvedValue(
      envelope([
        actionItem({
          push: {
            state: "no_devices",
            attempts: 1,
            last_attempt_at: null,
            next_attempt_at: null,
            detail: { devices: 0 },
          },
        }),
        actionItem({ item_id: ID_B }),
      ])
    );
    render(<CoordActionItemsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-action-items-health")).toHaveAttribute(
        "data-health-level",
        "red"
      )
    );
    expect(
      screen.getByTestId("action-items-undelivered-count")
    ).toHaveTextContent("not on phone 1");
    const row = screen.getByTestId(`action-item-${ID_A}`);
    expect(
      within(row).getByRole("button", { expanded: false })
    ).toHaveAttribute("data-attention", "author");
  });

  it("shows body, links and push state in the detail; app links are text", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await user.click(await screen.findByTestId("action-item-title"));

    expect(screen.getByTestId("action-item-body")).toHaveTextContent(
      "web#1780 is deployed."
    );
    const web = screen.getByTestId("action-item-link-web");
    expect(web).toHaveAttribute(
      "href",
      "https://qontinui.io/admin/coord/plan-library/settings"
    );
    expect(web).toHaveAttribute("target", "_blank");
    expect(web).toHaveAttribute("rel", "noopener noreferrer");
    const app = screen.getByTestId("action-item-link-app");
    expect(app).toHaveTextContent("Open on phone");
    expect(app.querySelector("a")).toBeNull();
    expect(screen.getByTestId("action-item-push-state")).toHaveTextContent(
      "pushed to your phone"
    );
  });

  it("Done resolves with the typed body and re-reads", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    httpPost.mockResolvedValue({ item: actionItem({ status: "done" }) });
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await user.click(await screen.findByTestId("action-item-title"));
    const before = httpGet.mock.calls.length;
    await user.click(screen.getByTestId(`action-item-done-${ID_A}`));

    await waitFor(() => expect(httpPost).toHaveBeenCalledTimes(1));
    expect(httpPost.mock.calls[0][0]).toBe(
      "/api/v1/operations/action-items/resolve"
    );
    expect(httpPost.mock.calls[0][1]).toEqual({
      item_id: ID_A,
      status: "done",
    });
    expect(httpPost.mock.calls[0][2]).toEqual(
      expect.objectContaining({ noRetryStatuses: [429, 503] })
    );
    await waitFor(() =>
      expect(httpGet.mock.calls.length).toBeGreaterThan(before)
    );
  });

  it("shows a resolve refusal on the row", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    httpPost.mockRejectedValue(
      new Error(
        'POST /api/v1/operations/action-items/resolve failed: 409 - {"detail":"already resolved"}'
      )
    );
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await user.click(await screen.findByTestId("action-item-title"));
    await user.click(screen.getByTestId(`action-item-dismiss-${ID_A}`));
    expect(
      await screen.findByTestId("action-item-resolve-error")
    ).toBeInTheDocument();
    expect(httpPost.mock.calls[0][1]).toEqual({
      item_id: ID_A,
      status: "dismissed",
    });
  });

  it("switching tabs asks coord for that status", async () => {
    httpGet.mockResolvedValue(envelope([]));
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await screen.findByTestId("action-items-empty");
    await user.click(screen.getByTestId("action-items-tab-done"));
    await waitFor(() =>
      expect(
        httpGet.mock.calls.some((c) => String(c[0]).includes("status=done"))
      ).toBe(true)
    );
  });

  it("renders migration pending as not-available-yet, not as an error", async () => {
    httpGet.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/action-items?status=open&limit=200 failed: 503 - {"error":"schema_migration_pending"}'
      )
    );
    render(<CoordActionItemsPage />);
    expect(
      await screen.findByTestId("action-items-migration-pending")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("action-items-read-error")).toBeNull();
    expect(screen.queryByTestId("action-items-empty")).toBeNull();
    expect(screen.getByTestId("action-items-tab-open")).toHaveTextContent(
      "Open–"
    );
  });

  it("a non-503 read failure is loud and never claims nothing is owed", async () => {
    httpGet.mockRejectedValue(
      new Error("GET /api/v1/operations/action-items failed: 500 - boom")
    );
    render(<CoordActionItemsPage />);
    expect(
      await screen.findByTestId("action-items-read-error")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("action-items-empty")).toBeNull();
  });

  it("an owed item is red even when its push landed", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    render(<CoordActionItemsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-action-items-health")).toHaveAttribute(
        "data-health-level",
        "red"
      )
    );
    expect(
      screen.getByTestId("action-items-undelivered-count")
    ).toHaveTextContent("not on phone 0");
    const row = screen.getByTestId(`action-item-${ID_A}`);
    expect(
      within(row).getByRole("button", { expanded: false })
    ).toHaveAttribute("data-attention", "author");
  });

  it("a 503 that is not migration-pending is a loud read failure", async () => {
    httpGet.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/action-items?status=open&limit=200 failed: 503 - {"error":"deadline","budget_ms":800}'
      )
    );
    render(<CoordActionItemsPage />);
    expect(
      await screen.findByTestId("action-items-read-error")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("action-items-migration-pending")).toBeNull();
  });

  it("a failed refresh after a success keeps the rows and says so", async () => {
    httpGet.mockResolvedValueOnce(envelope([actionItem()]));
    httpGet.mockRejectedValue(
      new Error("GET /api/v1/operations/action-items failed: 500 - boom")
    );
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await screen.findByTestId("action-item-title");
    await user.click(screen.getByTestId("action-items-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("coord-action-items-health")).toHaveTextContent(
        "Could not read action items — showing the last answer"
      )
    );
    expect(screen.getByTestId("coord-action-items-health")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(screen.getByTestId("action-item-title")).toBeInTheDocument();
  });

  it("a 409 already_resolved says so in words and re-reads", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    // The REAL wire shape: web's error handler puts coord's code at the top
    // level, renders `message` as a Python repr of coord's dict (not JSON),
    // and splices coord's other keys (`item`) into the envelope.
    const resolved = actionItem({ status: "dismissed" });
    const wire = {
      error: "already_resolved",
      message: `{'error': 'already_resolved', 'item': {'item_id': '${ID_A}'}}`,
      timestamp: 1760000000.5,
      path: "http://testserver/api/v1/operations/action-items/resolve",
      item: resolved,
    };
    httpPost.mockRejectedValue(
      new Error(
        `POST /api/v1/operations/action-items/resolve failed: 409 - ${JSON.stringify(wire)}`
      )
    );
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await user.click(await screen.findByTestId("action-item-title"));
    const before = httpGet.mock.calls.length;
    await user.click(screen.getByTestId(`action-item-done-${ID_A}`));
    expect(
      await screen.findByTestId("action-item-resolve-error")
    ).toHaveTextContent("Already resolved elsewhere — refreshed");
    expect(
      screen.getByTestId("action-item-resolve-error")
    ).not.toHaveTextContent("already_resolved");
    await waitFor(() =>
      expect(httpGet.mock.calls.length).toBeGreaterThan(before)
    );
  });

  it("a 409 with another code is an ordinary refusal and does not re-read", async () => {
    httpGet.mockResolvedValue(envelope([actionItem()]));
    httpPost.mockRejectedValue(
      new Error(
        'POST /api/v1/operations/action-items/resolve failed: 409 - {"error":"conflict","message":"something else"}'
      )
    );
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    await user.click(await screen.findByTestId("action-item-title"));
    const before = httpGet.mock.calls.length;
    await user.click(screen.getByTestId(`action-item-done-${ID_A}`));
    const shown = await screen.findByTestId("action-item-resolve-error");
    expect(shown).not.toHaveTextContent("Already resolved");
    expect(httpGet.mock.calls.length).toBe(before);
  });

  it("two concurrent resolves each keep their own buttons disabled", async () => {
    httpGet.mockResolvedValue(
      envelope([
        actionItem(),
        actionItem({ item_id: ID_B, title: "Second owed item" }),
      ])
    );
    const pending: Record<string, (v: unknown) => void> = {};
    httpPost.mockImplementation(
      (_url: string, body: { item_id: string }) =>
        new Promise((resolve) => {
          pending[body.item_id] = resolve;
        })
    );
    const user = userEvent.setup();
    render(<CoordActionItemsPage />);
    const titles = await screen.findAllByTestId("action-item-title");

    await user.click(titles[0]);
    await user.click(screen.getByTestId(`action-item-done-${ID_A}`));
    expect(screen.getByTestId(`action-item-done-${ID_A}`)).toBeDisabled();

    await user.click(screen.getAllByTestId("action-item-title")[1]);
    await user.click(screen.getByTestId(`action-item-done-${ID_B}`));
    expect(screen.getByTestId(`action-item-done-${ID_B}`)).toBeDisabled();

    // A finishes first. B's request is still out, so B must stay disabled —
    // a single "resolving id" slot would have been cleared here.
    pending[ID_A]({ item: actionItem({ status: "done" }) });
    await waitFor(() => expect(httpGet.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId(`action-item-done-${ID_B}`)).toBeDisabled();

    pending[ID_B]({ item: actionItem({ item_id: ID_B, status: "done" }) });
    await waitFor(() =>
      expect(screen.getByTestId(`action-item-done-${ID_B}`)).toBeEnabled()
    );
  });
});
