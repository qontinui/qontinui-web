/**
 * The settings sections take the cross-tab lock into their OWN controls
 * (plan `2026-11-09-prompt-documents-cross-tab-write-guard` Phase 6 step 2,
 * #6; H21). `PromptDocumentsRadixLock.test.tsx` covers the row menus, the
 * compliance panel and the ledger; this suite covers the rest of step 2:
 *
 * - the three fleet-policy dials' RadioGroups and their confirm buttons;
 * - the kind-tier buttons, their clear button and their confirm button;
 * - the compliance sessions' verdict filter.
 *
 * Every case mounts the section on a page that knows its project, lets it
 * load, and then locks the page the way the provider does when another tab
 * switches project — so a disabled control here is the LOCK's doing, not a
 * load that has not finished. Each case was killed by removing its
 * `pageLocked` term from the control's `disabled`. The no-send assertions
 * beside them are belt-and-braces only: `LOCKED_PAGE` also refuses every send
 * at the hooks, so the `disabled` assertions are what carry the proof.
 */
import { act, useState, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PINNED_PAGE, testPageGuard } from "../__fixtures__/pageWriteGuard";
import {
  PageWriteGuardContext,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import type { KindTierRow, KindTiersResponse } from "../types";

const getMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => getMock(...args),
      put: (...args: unknown[]) => putMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
      post: vi.fn(),
      patch: vi.fn(),
    }),
  };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { PolicyWriteDialControl } from "./PolicyWriteDialControl";
import { PolicyUpstreamDialControl } from "./PolicyUpstreamDialControl";
import { PolicyAutoPublishDialControl } from "./PolicyAutoPublishDialControl";
import { KindAuthorshipTierControl } from "./KindAuthorshipTierControl";
import { SessionComplianceSessions } from "./SessionComplianceSessions";

/** The page, loaded, once another tab has switched project. */
const LOCKED_PAGE: PageWriteGuardValue = testPageGuard({
  ...PINNED_PAGE,
  locked: "another_tab",
  writeAllowed: () => false,
  projectUnchanged: () => false,
  crossTabInEffect: () => true,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/**
 * Render `ui` under the page guard, starting at `PINNED_PAGE`; the returned
 * `lock()` moves the guard to `LOCKED_PAGE` the way the provider would.
 */
function renderSwitchable(ui: ReactNode) {
  let setGuard!: (g: PageWriteGuardValue) => void;
  function SwitchableGuard({ children }: { children: ReactNode }) {
    const [guard, set] = useState<PageWriteGuardValue>(PINNED_PAGE);
    setGuard = set;
    return (
      <PageWriteGuardContext.Provider value={guard}>
        {children}
      </PageWriteGuardContext.Provider>
    );
  }
  const utils = render(ui, { wrapper: SwitchableGuard });
  return {
    ...utils,
    lock: () => act(() => setGuard(LOCKED_PAGE)),
  };
}

function view(domain: string, effective_level: string): FleetPolicyView {
  return {
    domain,
    effective_level,
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
  } as FleetPolicyView;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const radios = () => screen.getAllByRole("radio") as HTMLButtonElement[];

/**
 * One case per dial: its id prefix, the level it loads at, a level applied on
 * one click, and the level that asks for confirmation.
 */
const DIALS = [
  {
    name: "policy-write",
    Control: PolicyWriteDialControl,
    domain: "policy_write",
    loaded: "tightening_only",
    immediate: "off",
    confirmed: "full",
  },
  {
    name: "policy-upstream",
    Control: PolicyUpstreamDialControl,
    domain: "policy_upstream",
    loaded: "notify",
    immediate: "off",
    confirmed: "auto",
  },
  {
    name: "policy-auto-publish",
    Control: PolicyAutoPublishDialControl,
    domain: "policy_auto_publish",
    loaded: "off",
    immediate: undefined,
    confirmed: "on",
  },
] as const;

/** The confirmation dialog's accept button: the one action that is not Cancel. */
function acceptButton(dialog: HTMLElement): HTMLButtonElement {
  const buttons = within(dialog).getAllByRole("button") as HTMLButtonElement[];
  const accept = buttons.filter((b) => !/cancel/i.test(b.textContent ?? ""));
  expect(accept).toHaveLength(1);
  return accept[0];
}

describe.each(DIALS)("H21 — the $name dial takes the lock", (dial) => {
  async function mount() {
    getMock.mockResolvedValue(view(dial.domain, dial.loaded));
    const r = renderSwitchable(<dial.Control />);
    await screen.findByTestId(`${dial.name}-dial`);
    await waitFor(() =>
      expect(radios().every((radio) => !radio.disabled)).toBe(true)
    );
    return r;
  }

  it("its items are disabled once the page locks, and a press does nothing", async () => {
    const { lock } = await mount();
    lock();

    for (const radio of radios()) expect(radio.disabled).toBe(true);

    await user().click(
      document.getElementById(`${dial.name}-${dial.confirmed}`)!
    );
    if (dial.immediate)
      await user().click(
        document.getElementById(`${dial.name}-${dial.immediate}`)!
      );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(putMock).not.toHaveBeenCalled();
    expect(
      (
        document.getElementById(`${dial.name}-${dial.loaded}`) as HTMLElement
      ).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("a confirmation opened before the lock cannot be accepted after it", async () => {
    const { lock } = await mount();
    await user().click(
      document.getElementById(`${dial.name}-${dial.confirmed}`)!
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(acceptButton(dialog).disabled).toBe(false);

    lock();

    const accept = acceptButton(screen.getByRole("alertdialog"));
    expect(accept.disabled).toBe(true);
    await user().click(accept);
    expect(putMock).not.toHaveBeenCalled();
  });
});

function kindRow(over: Partial<KindTierRow> = {}): KindTierRow {
  return {
    kind: "audience_profile",
    tier: "deny",
    unreadable: false,
    builtin_default_tier: "deny",
    effective_tier: "deny",
    effective_source: "operator",
    ...over,
  } as KindTierRow;
}

function kindTiers(): KindTiersResponse {
  return {
    kinds: [kindRow()],
    vocabulary: ["deny", "allow", "allow_with_notification"],
    notification_enforced: false,
    warning: "a warning",
  } as KindTiersResponse;
}

describe("H21 — the kind-tier buttons take the lock", () => {
  async function mount() {
    getMock.mockResolvedValue(kindTiers());
    const r = renderSwitchable(<KindAuthorshipTierControl />);
    const row = await screen.findByTestId("kind-tier-row-audience_profile");
    const button = (name: string) =>
      within(row).getByRole("button", { name }) as HTMLButtonElement;
    // Unlocked and loaded: every tier but the stored one, and clear, are live.
    await waitFor(() => expect(button("allow").disabled).toBe(false));
    expect(button("allow with notification").disabled).toBe(false);
    expect(button("clear").disabled).toBe(false);
    return { ...r, button };
  }

  it("every tier button and clear are disabled once the page locks", async () => {
    const { lock, button } = await mount();
    lock();

    expect(button("allow").disabled).toBe(true);
    expect(button("allow with notification").disabled).toBe(true);
    expect(button("clear").disabled).toBe(true);
    await user().click(button("allow"));
    await user().click(button("clear"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(putMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("a confirmation opened before the lock cannot be accepted after it", async () => {
    const { lock, button } = await mount();
    await user().click(button("allow"));
    const dialog = await screen.findByRole("alertdialog");
    expect(acceptButton(dialog).disabled).toBe(false);

    lock();

    const accept = acceptButton(screen.getByRole("alertdialog"));
    expect(accept.disabled).toBe(true);
    await user().click(accept);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("H21 — the compliance sessions' verdict filter takes the lock", () => {
  it("is disabled once the page locks, and enabled before", () => {
    const { lock } = renderSwitchable(
      <SessionComplianceSessions
        rows={[]}
        loading={false}
        unavailable={false}
        degraded={null}
        error={null}
        verdictFilter="all"
        onVerdictFilterChange={vi.fn()}
        nextCursor={null}
        atFirstPage
        onCursorChange={vi.fn()}
      />
    );
    const filter = () =>
      screen.getByTestId("compliance-verdict-filter") as HTMLButtonElement;
    expect(filter().disabled).toBe(false);
    lock();
    expect(filter().disabled).toBe(true);
  });
});
