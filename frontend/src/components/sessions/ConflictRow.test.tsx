import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConflictRow, deriveAlternateBranches } from "./ConflictRow";
import type { SessionRow } from "./types";

/**
 * ConflictRow — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Covers:
 *   - Both holder + challenger sides render with their respective
 *     hostnames + intent purpose
 *   - The resource-key badge surfaces the contested key
 *   - The Steal button opens the StealModal
 *   - The "Open different branch" dropdown auto-suggests names
 *     derived from the held branch
 *   - deriveAlternateBranches() helper produces -alt-1/-2/-3 suffixes
 *     and does not double-suffix on already-aliased branches
 */

function mockSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "tenant-1",
    device_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    session_kind: "agentic",
    intent: {
      purpose: "holder doing the auth hotfix",
      repo: "qontinui-web",
      branch: "feat/auth-hotfix",
    },
    state: "active",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    last_heartbeat_at: new Date(Date.now() - 5_000).toISOString(),
    closed_at: null,
    parent_session_id: null,
    repo: "qontinui-web",
    branch: "feat/auth-hotfix",
    ...overrides,
  };
}

function renderRow(overrides: Record<string, unknown> = {}) {
  const holder = mockSession();
  const challenger = mockSession({
    id: "22222222-2222-2222-2222-222222222222",
    device_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    intent: {
      purpose: "challenger needs the branch for review",
      repo: "qontinui-web",
      branch: "feat/auth-hotfix",
    },
  });
  return render(
    <TooltipProvider>
      <ConflictRow
        holder={holder}
        challenger={challenger}
        resourceKey="repo_branch:qontinui-web:feat/auth-hotfix"
        hostnameFor={(id) =>
          id === holder.device_id
            ? "msi-laptop"
            : id === challenger.device_id
              ? "spaceship"
              : undefined
        }
        {...overrides}
      />
    </TooltipProvider>
  );
}

describe("ConflictRow", () => {
  it("renders both sides with their hostnames + purpose", () => {
    renderRow();
    const sides = document.querySelectorAll(
      "[data-ui-bridge-id='conflict-row.side']"
    );
    expect(sides.length).toBe(2);

    const holderSide = document.querySelector("[data-conflict-side='holder']");
    const challengerSide = document.querySelector(
      "[data-conflict-side='challenger']"
    );
    expect(holderSide?.textContent).toContain("msi-laptop");
    expect(holderSide?.textContent).toContain("holder doing the auth hotfix");
    expect(challengerSide?.textContent).toContain("spaceship");
    expect(challengerSide?.textContent).toContain(
      "challenger needs the branch for review"
    );
  });

  it("surfaces the contested resource key", () => {
    renderRow();
    const badge = document.querySelector(
      "[data-ui-bridge-id='conflict-row.resource-key']"
    );
    expect(badge?.textContent).toContain(
      "repo_branch:qontinui-web:feat/auth-hotfix"
    );
  });

  it("calls onWait when the Wait button is clicked", () => {
    const onWait = vi.fn();
    renderRow({ onWait });
    fireEvent.click(screen.getByRole("button", { name: /^wait$/i }));
    expect(onWait).toHaveBeenCalledTimes(1);
  });

  it("opens the StealModal when the Steal button is clicked", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: /steal/i }));
    // The modal renders a Dialog primitive; the title is the deterministic
    // landmark.
    expect(
      document.querySelector("[data-ui-bridge-id='steal-modal']")
    ).not.toBeNull();
  });

  it("shows the alternate-branch dropdown when a branch is held", () => {
    renderRow();
    expect(
      document.querySelector(
        "[data-ui-bridge-id='conflict-row.alternate-branch']"
      )
    ).not.toBeNull();
  });

  it("hides the alternate-branch dropdown when no branch is contested", () => {
    renderRow({
      holder: mockSession({ branch: null, repo: null }),
      challenger: mockSession({
        id: "x",
        device_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        branch: null,
        repo: null,
      }),
    });
    expect(
      document.querySelector(
        "[data-ui-bridge-id='conflict-row.alternate-branch']"
      )
    ).toBeNull();
  });
});

describe("deriveAlternateBranches", () => {
  it("appends -alt-N suffixes to a clean branch name", () => {
    expect(deriveAlternateBranches("feat/auth")).toEqual([
      "feat/auth-alt-1",
      "feat/auth-alt-2",
      "feat/auth-alt-3",
    ]);
  });

  it("does not double-suffix already-aliased branches", () => {
    expect(deriveAlternateBranches("feat/auth-alt-2")).toEqual([
      "feat/auth-alt-1",
      "feat/auth-alt-2",
      "feat/auth-alt-3",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(deriveAlternateBranches("")).toEqual([]);
    expect(deriveAlternateBranches("   ")).toEqual([]);
  });
});
