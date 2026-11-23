/**
 * Every Radix control honours the cross-tab lock through its OWN `disabled`
 * (plan `2026-11-09-prompt-documents-cross-tab-write-guard` Phase 6, #6; H06,
 * H21). A Radix trigger or item does not see the page's disabled fieldset, so
 * the lock reaches each one explicitly. Each case renders the control under a
 * locked guard, asserts it is disabled, and renders it under an unlocked one
 * to prove the lock — not the control's own state — is what disabled it.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import { OutstandingWorkLedger } from "./OutstandingWorkLedger";
import { PublishModeControl } from "./PublishModeControl";
import { SessionComplianceEnforcementPanel } from "./SessionComplianceEnforcementPanel";
import { testPageGuard, withPageGuard } from "../__fixtures__/pageWriteGuard";
import type { SessionComplianceConfig } from "../compliance-types";
import type { PromptDocumentSummary } from "../types";

const LOCKED = withPageGuard(testPageGuard({ locked: "another_tab" }));
const UNLOCKED = withPageGuard(testPageGuard());
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function doc(): PromptDocumentSummary {
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
    agent_write_builtin_default_tier: "allow",
    publish_mode: "manual",
  } as PromptDocumentSummary;
}

function config(): SessionComplianceConfig {
  return {
    enabled: true,
    mode: "nudge",
    max_attempts: 2,
    enforced_clause_ref: "policy/x#y",
    applicable: true,
    applicability_reason: "clause_present",
  } as SessionComplianceConfig;
}

function panel() {
  return (
    <SessionComplianceEnforcementPanel
      config={config()}
      loading={false}
      saving={false}
      versions={[]}
      versionsLoading={false}
      versionsUnavailable={false}
      versionsDegraded={null}
      versionsError={null}
      onSave={vi.fn(async () => true)}
    />
  );
}

describe("H06 — row menus: the lock is the control's own disabled", () => {
  it("the tier menu trigger is disabled while locked and opens when unlocked", async () => {
    const d = doc();
    const id = `doc-access-toggle-${d.kind}-${d.name}`;
    const { unmount } = render(
      <AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />,
      { wrapper: LOCKED }
    );
    const locked = screen.getByTestId(id) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    await user().click(locked);
    expect(
      screen.queryByTestId(`doc-access-tier-${d.kind}-${d.name}-allow`)
    ).toBeNull();
    unmount();
    render(<AgentWriteAccessControl doc={d} saving={false} onSet={vi.fn()} />, {
      wrapper: UNLOCKED,
    });
    expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the publish-mode trigger is disabled while locked and opens when unlocked", async () => {
    const d = doc();
    const id = `doc-publish-mode-${d.kind}-${d.name}`;
    const { unmount } = render(
      <PublishModeControl doc={d} saving={false} onSet={vi.fn()} />,
      { wrapper: LOCKED }
    );
    const locked = screen.getByTestId(id) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    await user().click(locked);
    expect(
      screen.queryByTestId(`doc-publish-mode-auto-${d.kind}-${d.name}`)
    ).toBeNull();
    unmount();
    render(<PublishModeControl doc={d} saving={false} onSet={vi.fn()} />, {
      wrapper: UNLOCKED,
    });
    expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(false);
  });
});

/** Change the clause reference so the panel is dirty and Save is otherwise live. */
function dirty() {
  fireEvent.change(document.getElementById("compliance-clause-ref")!, {
    target: { value: "policy/other#clause" },
  });
}
const save = () =>
  screen.getByText("Save settings").closest("button") as HTMLButtonElement;

describe("H21 — compliance settings: switch, mode select and Save", () => {
  it("are disabled while locked, even with a dirty form", () => {
    render(panel(), { wrapper: LOCKED });
    dirty();
    expect(
      (screen.getByTestId("compliance-enabled") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("compliance-mode") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(save().disabled).toBe(true);
  });

  it("are enabled when unlocked and the form is dirty", () => {
    render(panel(), { wrapper: UNLOCKED });
    dirty();
    expect(
      (screen.getByTestId("compliance-enabled") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      (screen.getByTestId("compliance-mode") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(save().disabled).toBe(false);
  });
});

describe("H21 — the ledger's filters", () => {
  const ledger = () => (
    <OutstandingWorkLedger
      items={[
        {
          claude_session_id: "s-1",
          checked_at: "2026-11-20T10:00:00Z",
          ref: "item-1",
          state: "deferred",
        },
      ]}
      loading={false}
      unavailable={false}
      degraded={null}
      error={null}
    />
  );
  it("the state filter and sort are disabled while locked, enabled when not", () => {
    const { unmount } = render(ledger(), { wrapper: LOCKED });
    expect(
      (screen.getByTestId("outstanding-state-filter") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("outstanding-sort") as HTMLButtonElement).disabled
    ).toBe(true);
    unmount();
    render(ledger(), { wrapper: UNLOCKED });
    expect(
      (screen.getByTestId("outstanding-state-filter") as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (screen.getByTestId("outstanding-sort") as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
