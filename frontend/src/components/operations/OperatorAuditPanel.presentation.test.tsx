/**
 * The operator audit feed in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): a narrowing the
 * presenter cannot see the control for is SAID.
 *
 * The resource-key search takes device ids, so its form is the operator's
 * alone. A search applied before presenting still narrows the feed — and a
 * narrowed read under a caption about the fleet's changes would pass for the
 * whole record (`verification-and-evidence` `silent-empty-is-unknown`). So the
 * presented feed says it is narrowed, in fixed words (never the key), offers
 * a navigation-only way back, and re-reads nothing just because the mode
 * changed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    fetch: async (url: string, init?: unknown) =>
      new Response(JSON.stringify(await getMock(url, init)), { status: 200 }),
  },
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true, loading: false, user: { id: "u-1" } }),
}));

import { UNKNOWN_AMBER } from "@/components/console";
import {
  FixedPresentationMode,
  NAVIGATION_ONLY_ATTRIBUTE,
} from "@/components/presentation";
import { OperatorAuditPanel } from "./OperatorAuditPanel";
import type { AuditRow } from "./operatorAudit";

const DEVICE_KEY = "22222222-2222-2222-2222-222222222222";

const DRAIN_ROW: AuditRow = {
  audit_id: "aud-1",
  operator_id: "11111111-1111-1111-1111-111111111111",
  action: "fleet.drain.set",
  resource_kind: "coord.devices",
  resource_key: DEVICE_KEY,
  metadata: { device_id: DEVICE_KEY, drained: true, reason: "rebuild" },
  occurred_at: "2026-10-27T10:00:00Z",
};

function Panel({ presenting }: { presenting: boolean }) {
  return (
    <FixedPresentationMode presenting={presenting}>
      <OperatorAuditPanel />
    </FixedPresentationMode>
  );
}

const lastUrl = () => String(getMock.mock.calls.at(-1)?.[0] ?? "");

/** Render for the operator, open the feed, and apply a resource-key search. */
async function narrowAsOperator() {
  const view = render(<Panel presenting={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
  await waitFor(() => expect(getMock).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("operator-audit-resource-key"), {
    target: { value: DEVICE_KEY },
  });
  fireEvent.click(screen.getByTestId("operator-audit-resource-key-apply"));
  await waitFor(() => expect(lastUrl()).toContain(`resource_key=${DEVICE_KEY}`));
  return view;
}

beforeEach(() => {
  getMock.mockReset();
  window.localStorage.clear();
});

describe("OperatorAuditPanel?present=1 — a narrowed feed says so", () => {
  it("says, in fixed words, that a search applied before presenting narrows the feed, and offers the whole feed back", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    const view = await narrowAsOperator();
    const readsBefore = getMock.mock.calls.length;

    view.rerender(<Panel presenting />);

    const narrowed = screen.getByTestId("operator-audit-narrowed");
    expect(narrowed).toHaveTextContent(
      "Showing one resource's changes only; changes to everything else are not shown."
    );
    // The key is an identifier: the notice never carries it.
    expect(document.body.textContent).not.toContain(DEVICE_KEY);
    // The mode change re-read nothing (D3.4): the view says what it shows.
    expect(getMock.mock.calls.length).toBe(readsBefore);

    // The way back is a view control, live while presenting.
    const showAll = screen.getByTestId("operator-audit-narrowed-clear");
    expect(showAll).toHaveAttribute(NAVIGATION_ONLY_ATTRIBUTE);
    fireEvent.click(showAll);
    await waitFor(() => expect(lastUrl()).not.toContain("resource_key="));
    expect(screen.queryByTestId("operator-audit-narrowed")).toBeNull();
  });

  it("says an empty narrowed view is narrowed — in fixed words, not coord's filter terms", async () => {
    getMock.mockResolvedValue({ audit: [], count: 0 });
    const view = await narrowAsOperator();
    view.rerender(<Panel presenting />);
    const empty = await screen.findByTestId("operator-audit-empty-presented");
    expect(empty).toHaveTextContent(
      "No recorded change matches this view, which is narrowed to one resource."
    );
    expect(document.body.textContent).not.toMatch(
      /fleet\.\*|rows for this tenant at all/
    );
  });

  it("(control) says nothing of narrowing when nothing narrows the feed", async () => {
    getMock.mockResolvedValue({ audit: [DRAIN_ROW], count: 1 });
    render(<Panel presenting />);
    fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await screen.findByTestId("audit-row-aud-1");
    expect(screen.queryByTestId("operator-audit-narrowed")).toBeNull();
    expect(lastUrl()).not.toContain("resource_key=");
  });

  it("(operator) an empty narrowed read names the key it was narrowed to", async () => {
    getMock.mockResolvedValue({ audit: [], count: 0 });
    await narrowAsOperator();
    await waitFor(() =>
      expect(document.body.textContent).toMatch(
        new RegExp(`for resource key\\s*${DEVICE_KEY}\\s*rows for this tenant`)
      )
    );
  });
});

describe("OperatorAuditPanel — a page coord cut at its row limit says so", () => {
  const rows = (n: number): AuditRow[] =>
    Array.from({ length: n }, (_, i) => ({
      ...DRAIN_ROW,
      audit_id: `aud-${i}`,
    }));

  async function open(presenting: boolean) {
    render(<Panel presenting={presenting} />);
    fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  }

  it("says older rows were left out when coord says it truncated — for the operator and, without a count, for an outsider", async () => {
    getMock.mockResolvedValue({ audit: rows(3), count: 3, truncated: true });
    await open(false);
    expect(
      await screen.findByTestId("operator-audit-truncated")
    ).toHaveTextContent(
      "Coord returned the newest 3 matching rows and left older ones out (truncated)"
    );
  });

  it("presenting: the same, in fixed words", async () => {
    getMock.mockResolvedValue({ audit: rows(3), count: 3, truncated: true });
    await open(true);
    const note = await screen.findByTestId("operator-audit-truncated");
    expect(note).toHaveTextContent(
      "Only the newest changes are shown; older ones were left out of this view."
    );
    expect(note.getAttribute("data-truncated")).toBe("true");
  });

  it("says older rows MAY be missing when coord does not say and a full page came back", async () => {
    getMock.mockResolvedValue({ audit: rows(100), count: 100 });
    await open(true);
    const note = await screen.findByTestId("operator-audit-truncated");
    expect(note.getAttribute("data-truncated")).toBe("unknown");
    expect(note).toHaveTextContent(/may have been left out/);
  });

  it("(control) says nothing when coord says nothing was cut", async () => {
    getMock.mockResolvedValue({ audit: rows(3), count: 3, truncated: false });
    await open(true);
    await screen.findByTestId("audit-row-aud-0");
    expect(screen.queryByTestId("operator-audit-truncated")).toBeNull();
  });
});

describe("OperatorAuditPanel?present=1 — a row whose author was not recorded", () => {
  /** Coord's nil UUID: the writer resolved no operator. */
  const NIL_ROW: AuditRow = {
    ...DRAIN_ROW,
    audit_id: "aud-nil",
    operator_id: "00000000-0000-0000-0000-000000000000",
  };

  /** Open the feed and the nil-operator row; returns its Operator marker. */
  async function openNilRow(presenting: boolean): Promise<HTMLElement> {
    getMock.mockResolvedValue({ audit: [NIL_ROW], count: 1 });
    render(<Panel presenting={presenting} />);
    fireEvent.click(screen.getByRole("button", { name: /Operator audit/i }));
    const row = await screen.findByTestId("audit-row-aud-nil");
    const toggle = row.querySelector("button[aria-expanded]");
    if (!toggle) throw new Error("the audit row has no disclosure toggle");
    fireEvent.click(toggle);
    return screen.getByTestId("audit-nil-operator");
  }

  it("says so in plain words, with a plain title, on amber — never the operator's account of coord's fallback", async () => {
    const marker = await openNilRow(true);
    expect(marker).toHaveTextContent("operator not recorded");
    expect(marker.getAttribute("title")).toBe(
      "This change was recorded without who made it."
    );
    // Who made the change is unknown, so the cell wears the ignorance-floor
    // amber (style guide R3) — never the calm of a recorded value.
    expect(marker).toHaveClass(...UNKNOWN_AMBER.split(" "));
    // Not in its text, its title, or anywhere else on the panel.
    expect(document.body.innerHTML).not.toMatch(
      /resolve_operator_id|nil UUID|qontinui-web never sends/
    );
  });

  it("(operator) keeps coord's explanation of the fallback, where it is a fact to act on", async () => {
    const marker = await openNilRow(false);
    expect(marker).toHaveTextContent("operator not recorded");
    expect(marker.getAttribute("title")).toContain(
      "`resolve_operator_id(&headers)` fallback"
    );
  });
});
