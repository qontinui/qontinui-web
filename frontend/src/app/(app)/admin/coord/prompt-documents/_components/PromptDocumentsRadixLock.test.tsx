/**
 * Every Radix control honours the cross-tab lock through its OWN `disabled`
 * (plan `2026-11-09-prompt-documents-cross-tab-write-guard` Phase 6, #6; H06,
 * H21). A Radix trigger or item does not see the page's disabled fieldset, so
 * the lock reaches each one explicitly. Each case renders the control under a
 * locked guard, asserts it is disabled, and renders it under an unlocked one
 * to prove the lock — not the control's own state — is what disabled it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
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

describe("H21 — compliance settings: switch, mode select and Save", () => {
  it("are disabled while locked", () => {
    render(panel(), { wrapper: LOCKED });
    expect(
      (screen.getByTestId("compliance-enabled") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("compliance-mode") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByText("Save settings").closest("button") as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("the switch and the mode select are enabled when unlocked", () => {
    render(panel(), { wrapper: UNLOCKED });
    expect(
      (screen.getByTestId("compliance-enabled") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      (screen.getByTestId("compliance-mode") as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
