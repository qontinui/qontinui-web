/**
 * AgentWriteAccessControl — the per-document badge and toggle, read against
 * coord's TIER rather than its legacy boolean projection.
 *
 * Every case here is one where the legacy read produced a confident, wrong
 * answer that nothing else on the page corrects:
 *
 * 1. **`operator_kind` is not `default`.** Coord answers `"operator_kind"` when
 *    a tenant setting on the KIND decided. Folded into `"default"` — which is
 *    what a two-way `source === "operator"` test does — the badge tells an
 *    operator that nobody has ruled on a document their own kind-wide setting
 *    is deciding, and promises the row tracks coord's default when a stored
 *    kind tier does the opposite.
 * 2. **`allow_with_notification` is not `allow`.** The boolean projects it to
 *    `true`, so the notification tier renders as plainly open. The per-kind
 *    control on this page makes that tier settable, so this is a state the page
 *    itself produces.
 * 3. **An unrecognized tier is UNKNOWN, never open**, and the toggle goes dead
 *    with it — a toggle whose current position this build cannot state is not
 *    one an operator can move safely.
 * 4. **The two-state write is lossy in the permissive direction**, and it is
 *    disclosed at the point of the click rather than discovered after it.
 * 5. **A pre-tier coord still renders**, unchanged. The tier fields are omitted
 *    entirely by a build that predates them, and that window is real.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import type { PromptDocumentSummary } from "../types";

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
const toggle = (d: PromptDocumentSummary) =>
  screen.getByTestId(`doc-access-toggle-${d.kind}-${d.name}`);

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

  it("discloses that protecting the document discards the stored tier", () => {
    const d = doc({
      agent_write_source: "operator",
      agent_write_tier: "allow_with_notification",
      agent_write_effective_tier: "allow_with_notification",
      agent_write_effective: true,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    const title = toggle(d).getAttribute("title") ?? "";
    expect(title).toContain("clears its stored `allow_with_notification` tier");
    expect(title).toContain("restores plain `allow`");
  });

  it("does not claim a loss when the notification tier came from the kind", () => {
    // Nothing is discarded here: the stored tier is on the KIND, and protecting
    // the document writes a per-document row without touching it.
    const d = doc({
      agent_write_source: "operator_kind",
      agent_write_tier: null,
      agent_write_effective_tier: "allow_with_notification",
      agent_write_effective: true,
    });
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />);

    const title = toggle(d).getAttribute("title") ?? "";
    expect(title).not.toContain("clears its stored");
    expect(title).toContain("overrides the kind");
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
    expect(toggle(d)).toBeDisabled();
    expect(toggle(d).getAttribute("title") ?? "").toContain(
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
    expect(toggle(bare)).toBeDisabled();
  });

  it("falls back to the legacy boolean for a coord that predates the tier", () => {
    const legacy = doc({
      agent_write_effective: true,
      agent_write_source: "operator",
    });
    delete legacy.agent_write_effective_tier;
    render(
      <AgentWriteAccessControl doc={legacy} saving={false} onSet={vi.fn()} />
    );

    expect(badge(legacy)).toHaveTextContent("Agent-writable (set)");
    expect(toggle(legacy)).not.toBeDisabled();
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
    expect(toggle(d)).not.toBeDisabled();
  });
});
