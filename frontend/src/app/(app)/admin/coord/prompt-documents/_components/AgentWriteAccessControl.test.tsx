/**
 * AgentWriteAccessControl — the per-document badge and TIER picker, read and
 * written against coord's three-state tier rather than its legacy boolean
 * projection.
 *
 * Every case here is one where the two-state control produced a confident,
 * wrong answer that nothing else on the page corrects:
 *
 * 1. **`operator_kind` is not `default`.** Coord answers `"operator_kind"` when
 *    a tenant setting on the KIND decided. Folded into `"default"` — which is
 *    what a two-way `source === "operator"` test does — the badge tells an
 *    operator that nobody has ruled on a document their own kind-wide setting
 *    is deciding, and promises the row tracks coord's default when a stored
 *    kind tier does the opposite.
 * 2. **`allow_with_notification` is not `allow`.** The boolean projects it to
 *    `true`, so the notification tier renders as plainly open — and, until this
 *    control gained the third state, could not be WRITTEN at all. An operator
 *    who chose it on `initiative` and `success_metric` got plain `allow` and
 *    the agent writes it authorised landed unannounced (Portofino tenant,
 *    2026-09-03).
 * 3. **An unrecognized tier is UNKNOWN, never open**, and the picker goes dead
 *    with it — a control whose current position this build cannot state is not
 *    one an operator can move safely.
 * 4. **The write is three-state and carries no boolean.** The PATCH sends
 *    `agent_write_tier`; `agent_writable` is coord's legacy projection and can
 *    preserve the notification tier but never produce it.
 * 5. **`(default)` is rendered and never offered.** Coord has no wire encoding
 *    to clear a per-document tier back to `null`, so an item that offered it
 *    would be a click coord cannot carry out.
 * 6. **A pre-tier coord still renders**, unchanged. The tier fields are omitted
 *    entirely by a build that predates them, and that window is real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    patch: (...args: unknown[]) => patchMock(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import { PromptDocumentList } from "./PromptDocumentList";
import type { AgentWriteTier, PromptDocumentSummary } from "../types";

function doc(over: Partial<PromptDocumentSummary> = {}): PromptDocumentSummary {
  return {
    id: "doc-1",
    kind: "audience_profile",
    name: "example-audience",
    description: "an audience profile",
    format: "markdown",
    default_source: "prompt_doc/audience_profile/example-audience/v1",
    current_version: 1,
    updated_by: null,
    updated_at: "2026-08-28T10:00:00Z",
    attrs: null,
    agent_writable: null,
    agent_write_tier: null,
    agent_write_effective_tier: "allow",
    agent_write_effective: true,
    agent_write_source: "operator_kind",
    agent_write_builtin_default: true,
    ...over,
  };
}

const badge = (d: PromptDocumentSummary) =>
  screen.getByTestId(`doc-access-${d.kind}-${d.name}`);
const trigger = (d: PromptDocumentSummary) =>
  screen.getByTestId(`doc-access-toggle-${d.kind}-${d.name}`);

// Radix opens the menu on a pointer sequence, not a bare MouseEvent click —
// userEvent (pointer checks disabled for jsdom) drives it reliably. Same setup
// the gates console's own dropdown tests use.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Open the tier menu and return the item for one tier. */
async function openMenu(d: PromptDocumentSummary, tier: AgentWriteTier) {
  await user().click(trigger(d));
  return screen.findByTestId(`doc-access-tier-${d.kind}-${d.name}-${tier}`);
}

/** Open the menu and choose `tier`. */
async function choose(d: PromptDocumentSummary, tier: AgentWriteTier) {
  await user().click(await openMenu(d, tier));
}

/** The title on one tier's menu item, with the menu left open. */
async function itemTitle(d: PromptDocumentSummary, tier: AgentWriteTier) {
  return (await openMenu(d, tier)).getAttribute("title") ?? "";
}

beforeEach(() => {
  getMock.mockReset();
  patchMock.mockReset();
});

describe("AgentWriteAccessControl — which level decided", () => {
  it("attributes a kind-wide setting to the kind, not to coord's default", () => {
    const d = doc({ agent_write_source: "operator_kind" });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Agent-writable (kind)");
    const title = badge(d).getAttribute("title") ?? "";
    expect(title).toContain("KIND");
    // The two claims the folded-into-default rendering made, both false here.
    expect(title).not.toContain("No operator has ruled");
    expect(title).not.toContain("tracks the default");
    // And the remedy points at the control that actually holds the setting.
    expect(title).toContain("Agent authorship by kind");
  });

  it("still says nobody has ruled when nobody has", () => {
    const d = doc({
      agent_write_source: "default",
      agent_write_effective_tier: "allow",
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Agent-writable (default)");
    expect(badge(d).getAttribute("title") ?? "").toContain(
      "No operator has ruled on this document or on its kind"
    );
  });

  it("renders a kind-wide deny as protected, not as a built-in default", () => {
    const d = doc({
      agent_write_source: "operator_kind",
      agent_write_effective_tier: "deny",
      agent_write_effective: false,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Protected (kind)");
    // The built-in-rule wording belongs to `source: "default"` alone; using it
    // here would name a reason coord did not give.
    expect(badge(d).getAttribute("title") ?? "").not.toContain(
      "coord's built-in rule"
    );
  });
});

describe("AgentWriteAccessControl — the notification tier", () => {
  it("renders allow_with_notification as its own state, with the disclosure", () => {
    const d = doc({
      agent_write_source: "operator",
      agent_write_tier: "allow_with_notification",
      agent_write_effective_tier: "allow_with_notification",
      agent_write_effective: true,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Agent-writable, notify (set)");
    expect(badge(d)).toHaveAttribute("data-tier", "allow_with_notification");
    const title = badge(d).getAttribute("title") ?? "";
    expect(title).toContain("allow_with_notification");
    // It points at the control that REPORTS enforcement rather than claiming
    // it: coord ships `notification_enforced` on the per-kind response and
    // nowhere on the document one, so a claim here would have no source and
    // would go stale in the permissive direction when Phase 2 lands.
    expect(title).toContain("Agent authorship by kind");
    expect(title).not.toMatch(/is not enforced|is enforced/);
  });

  it("says protecting the document REPLACES the stored tier, and that it can be set again", async () => {
    const d = doc({
      agent_write_source: "operator",
      agent_write_tier: "allow_with_notification",
      agent_write_effective_tier: "allow_with_notification",
      agent_write_effective: true,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    const title = await itemTitle(d, "deny");
    expect(title).toContain("replaces the `allow_with_notification` tier");
    expect(title).toContain("you can set it again from this menu");
    // The old two-state copy promised the opposite, and that promise WAS the
    // defect: re-opening restored plain `allow` because nothing could write the
    // notification tier back.
    expect(title).not.toContain("restores plain `allow`");
  });

  it("does not claim a replacement when the notification tier came from the kind", async () => {
    // Nothing of this document's own is replaced here: the stored tier is on
    // the KIND, and choosing a tier writes a per-document row without touching
    // it.
    const d = doc({
      agent_write_source: "operator_kind",
      agent_write_tier: null,
      agent_write_effective_tier: "allow_with_notification",
      agent_write_effective: true,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    const title = await itemTitle(d, "deny");
    expect(title).not.toContain("replaces the");
    expect(title).toContain("overrides the kind");
  });
});

describe("AgentWriteAccessControl — the three-state write", () => {
  /**
   * The state the operator tried and failed to reach on 2026-09-03.
   *
   * The assertion that matters is the ARGUMENT: a tier string, not a boolean.
   * `onSet(true)` was accepted by coord as "at least allow", which is why the
   * failure was silent — the write landed, on the wrong tier.
   */
  it("hands the chosen tier to onSet, never a boolean", async () => {
    const onSet = vi.fn().mockResolvedValue(true);
    const d = doc({ agent_write_source: "default", agent_write_tier: null });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={onSet} />);

    await choose(d, "allow_with_notification");

    expect(onSet).toHaveBeenCalledWith("allow_with_notification");
    expect(onSet).not.toHaveBeenCalledWith(true);
    expect(onSet).not.toHaveBeenCalledWith(false);
  });

  it("offers exactly coord's three tiers and never a settable (default)", async () => {
    const d = doc();
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    await user().click(trigger(d));
    for (const tier of ["deny", "allow", "allow_with_notification"] as const) {
      expect(
        await screen.findByTestId(`doc-access-tier-${d.kind}-${d.name}-${tier}`)
      ).toBeInTheDocument();
    }
    // `null` is a state coord reports and this control shows — as a header, not
    // as a choice. There is no wire encoding to write it back, so an item
    // offering it would be a click coord cannot carry out.
    expect(
      screen.queryByTestId(`doc-access-tier-${d.kind}-${d.name}-default`)
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`doc-access-stored-${d.kind}-${d.name}`)
    ).toHaveAttribute("data-stored", "default");
  });

  it("names the row's own setting separately from the tier coord resolved", async () => {
    // Resolved `allow_with_notification` from the KIND, nothing stored on the
    // row. The badge and the menu header answer two different questions and
    // must not be collapsed into one.
    const d = doc({
      agent_write_source: "operator_kind",
      agent_write_tier: null,
      agent_write_effective_tier: "allow_with_notification",
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveAttribute("data-tier", "allow_with_notification");
    expect(badge(d)).toHaveAttribute("data-stored", "default");

    await user().click(trigger(d));
    expect(
      await screen.findByTestId(`doc-access-stored-${d.kind}-${d.name}`)
    ).toHaveTextContent("(default) — no setting of its own");
  });

  /**
   * The PATCH body, asserted where it is actually built.
   *
   * `agent_writable` is still on the wire type on purpose — other clients send
   * it and coord's "at least allow" reading is correct for them. What this pins
   * is that THIS control stopped sending it, because a `true` cannot produce
   * the notification tier.
   */
  it("PATCHes agent_write_tier and no agent_writable", async () => {
    const row = doc({
      kind: "initiative",
      name: "ship-the-console",
      agent_write_source: "default",
      agent_write_tier: null,
      agent_write_effective_tier: "allow",
    });
    getMock.mockResolvedValue({ documents: [row], degraded: null });
    patchMock.mockResolvedValue({ ...row, current_version: 2 });

    render(<PromptDocumentList />);
    await screen.findByTestId(`doc-access-${row.kind}-${row.name}`);

    await choose(row, "allow_with_notification");

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [path, body] = patchMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toContain("/coord/prompt-documents/initiative/");
    expect(body.agent_write_tier).toBe("allow_with_notification");
    expect(body).not.toHaveProperty("agent_writable");
    expect(String(body.change_description)).toContain(
      "allow_with_notification"
    );
  });
});

/**
 * The loss `AgentWriteAccessControl` used to disclose at the point of the
 * click: protect a document carrying `allow_with_notification`, re-open it, and
 * the two-state write restored plain `allow`.
 *
 * ## What "lossless" means here, exactly
 *
 * Coord has no wire encoding to clear a per-document tier back to `null`, so
 * "close it" means writing `deny` and "re-open it" means writing a tier again.
 * The round trip is therefore lossless **because the operator can now re-pick
 * the tier they had** — the control can express it. It is not lossless in the
 * sense of coord remembering the discarded value: the stored tier is genuinely
 * overwritten by the `deny`, and nothing restores it automatically. That is the
 * whole of what this change delivers, and the assertions below are written to
 * claim exactly that and no more.
 */
describe("AgentWriteAccessControl — the notification tier survives a round trip", () => {
  /**
   * A document row that resolves the way coord does for a per-document tier:
   * an explicit setting on the row wins over the kind and the built-in default,
   * and `source` becomes `"operator"`.
   */
  function Harness({ initial }: { initial: PromptDocumentSummary }) {
    const [d, setD] = useState(initial);
    return (
      <AgentWriteAccessControl
        doc={d}
        saving={false}
        onSet={async (tier) => {
          setD((prev) => ({
            ...prev,
            agent_write_tier: tier,
            agent_write_effective_tier: tier,
            agent_write_effective: tier !== "deny",
            agent_write_source: "operator",
          }));
          return true;
        }}
      />
    );
  }

  it("returns to allow_with_notification, not to allow", async () => {
    const d = doc({
      agent_write_source: "default",
      agent_write_tier: null,
      agent_write_effective_tier: "allow",
    });
    render(<Harness initial={d} />);

    // 1. The operator sets the notification tier.
    await choose(d, "allow_with_notification");
    await waitFor(() =>
      expect(badge(d)).toHaveAttribute("data-tier", "allow_with_notification")
    );
    expect(badge(d)).toHaveAttribute("data-stored", "allow_with_notification");
    expect(badge(d)).toHaveTextContent("Agent-writable, notify (set)");

    // 2. They protect it. This DOES overwrite the stored tier — coord stores
    //    one value per row and there is no encoding for "unset".
    await choose(d, "deny");
    await waitFor(() => expect(badge(d)).toHaveAttribute("data-tier", "deny"));
    expect(badge(d)).toHaveAttribute("data-stored", "deny");

    // 3. They open it again, choosing the same tier. THIS is the regression the
    //    two-state control could not pass: its write was a boolean `true`, and
    //    coord's "at least allow" reading of it resolved to plain `allow`.
    await choose(d, "allow_with_notification");
    await waitFor(() =>
      expect(badge(d)).toHaveAttribute("data-tier", "allow_with_notification")
    );
    expect(badge(d)).toHaveAttribute("data-stored", "allow_with_notification");
    expect(badge(d)).not.toHaveAttribute("data-tier", "allow");
    expect(badge(d)).toHaveTextContent("Agent-writable, notify (set)");
  });
});

describe("AgentWriteAccessControl — unknown states", () => {
  it("treats a tier this build does not recognise as unknown, not open", () => {
    const d = doc({
      agent_write_effective_tier: "allow_with_quorum",
      // The legacy boolean says OPEN. Preferring it here is exactly the
      // overstatement the tier read exists to stop.
      agent_write_effective: true,
      agent_write_source: "operator",
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Access unknown");
    expect(badge(d)).toHaveAttribute("data-tier", "unknown");
    expect(trigger(d)).toBeDisabled();
    expect(trigger(d).getAttribute("title") ?? "").toContain(
      "allow_with_quorum"
    );
  });

  it("still reports a coord that sends no access fields at all", () => {
    const bare = doc();
    delete bare.agent_write_effective_tier;
    delete bare.agent_write_effective;
    delete bare.agent_write_source;
    render(
      <AgentWriteAccessControl doc={bare} saving={false} onSet={vi.fn()} />
    );

    expect(badge(bare)).toHaveTextContent("Access unknown");
    expect(trigger(bare)).toBeDisabled();
  });

  it("falls back to the legacy boolean for a coord that predates the tier", () => {
    // The READ fallback stays: a pre-tier coord sends only the boolean, and
    // `true` means "at least allow", the same reading coord gives it on the way
    // in. Only the WRITE stopped using the boolean.
    const legacy = doc({
      agent_write_effective: true,
      agent_write_source: "operator",
    });
    delete legacy.agent_write_effective_tier;
    render(
      <AgentWriteAccessControl doc={legacy} saving={false} onSet={vi.fn()} />
    );

    expect(badge(legacy)).toHaveTextContent("Agent-writable (set)");
    expect(trigger(legacy)).not.toBeDisabled();
  });

  it("says a coord that does not report the row's own setting has not reported it", async () => {
    // `undefined` is not `null`. Rendering it as "(default)" would assert a
    // value this build never received.
    const d = doc();
    delete d.agent_write_tier;
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveAttribute("data-stored", "unreported");
    await user().click(trigger(d));
    expect(
      await screen.findByTestId(`doc-access-stored-${d.kind}-${d.name}`)
    ).toHaveTextContent("not reported by this coord");
  });

  /**
   * A tier with no attribution. The tier is renderable and the REASON is not,
   * and the badge must say only the half it has — picking a source would be the
   * same overstatement the unrecognized-tier arm refuses to make about the tier
   * itself, just quieter.
   */
  it("renders the tier without a source it was not given", () => {
    const d = doc({ agent_write_effective_tier: "allow" });
    delete d.agent_write_source;
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    expect(badge(d)).toHaveTextContent("Agent-writable");
    const title = badge(d).getAttribute("title") ?? "";
    expect(title).toContain("did not report which level decided");
    expect(title).not.toContain("No operator has ruled");
    // Still operable: what is unknown is the reason, not the state in force.
    expect(trigger(d)).not.toBeDisabled();
  });
});
