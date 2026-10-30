/**
 * What the toggle says beside itself about the scope: a presenter told that
 * every title is being withheld, and told nothing the mode keeps off screen
 * (`PresentationModeToggle.tsx`). The toggle's own press and states are
 * `PresentationModeProvider.test.tsx`'s.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationScopeRecord } from "@/lib/api/presentationScope";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

import {
  FixedPresentationMode,
  PresentationModeProvider,
} from "./PresentationModeProvider";
import { PresentationModeToggle } from "./PresentationModeToggle";
import {
  PresentationScopeProvider,
  type PresentationScopeState,
} from "./presentationScope";
import {
  createPresentationScopeStore,
  usePresentationScope,
  type PresentationScopeStore,
} from "./presentationScopeLoader";

const REASON = "first-party owners unknown (Acme Corp's coord refused)";
const FAILED: PresentationScopeState = { status: "error", reason: REASON };
const NO_OWNERS: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: [], confidentialTerms: [] },
};

function renderToggle(state: PresentationScopeState) {
  return render(
    <FixedPresentationMode presenting>
      <PresentationScopeProvider state={state}>
        <PresentationModeToggle />
      </PresentationScopeProvider>
    </FixedPresentationMode>
  );
}

function failedNotice() {
  return screen.queryByTestId("presentation-scope-failed-notice");
}

function noOwnersNotice() {
  return screen.queryByTestId("presentation-no-owners-notice");
}

describe("PresentationModeToggle — the withheld notice", () => {
  it("says every title is withheld while presenting on a scope that failed", () => {
    renderToggle(FAILED);
    expect(failedNotice()).toHaveTextContent("Titles withheld: scope unknown");
    expect(failedNotice()).toHaveAttribute(
      "title",
      expect.stringContaining("no longer sharing this screen")
    );
    expect(noOwnersNotice()).toBeNull();
  });

  it("shows the failure's own wording nowhere, attributes included", () => {
    const { container } = renderToggle(FAILED);
    expect(container.innerHTML).not.toContain("Acme Corp");
  });

  it("says every title is withheld on a project with no first-party owners", () => {
    renderToggle(NO_OWNERS);
    expect(noOwnersNotice()).toHaveTextContent(
      "Titles withheld: no first-party owners"
    );
    expect(noOwnersNotice()).toHaveAttribute(
      "title",
      expect.stringContaining("no longer sharing this screen")
    );
    expect(failedNotice()).toBeNull();
  });

  it.each<[string, PresentationScopeState]>([
    ["unknown", { status: "unknown" }],
    ["loading", { status: "loading" }],
    [
      "ready",
      {
        status: "ready",
        scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
      },
    ],
  ])("says nothing on a scope that is %s", (_name, state) => {
    renderToggle(state);
    expect(screen.getByTestId("presentation-mode-chip")).toBeInTheDocument();
    expect(failedNotice()).toBeNull();
    expect(noOwnersNotice()).toBeNull();
  });

  it("applies its caller's placement to the notice and the control together", () => {
    const { container } = render(
      <FixedPresentationMode presenting>
        <PresentationScopeProvider state={FAILED}>
          <PresentationModeToggle className="ml-auto" />
        </PresentationScopeProvider>
      </FixedPresentationMode>
    );
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("ml-auto");
    expect(wrapper).toContainElement(failedNotice());
    expect(wrapper).toContainElement(
      screen.getByTestId("presentation-mode-chip")
    );
  });

  describe("across the store's reads", () => {
    function rig() {
      const calls: Array<{
        resolve: (r: PresentationScopeRecord) => void;
        reject: (e: Error) => void;
      }> = [];
      const clock = { t: 1_000_000 };
      const store = createPresentationScopeStore({
        load: () =>
          new Promise((resolve, reject) => calls.push({ resolve, reject })),
        readSelection: () => "project-a",
        now: () => clock.t,
        watchStorage: false,
      });
      return { calls, clock, store };
    }

    function Lens({ store }: { store: PresentationScopeStore }) {
      return (
        <PresentationScopeProvider state={usePresentationScope(store)}>
          <PresentationModeToggle />
        </PresentationScopeProvider>
      );
    }

    it("holds through a retry in flight, and goes when a read answers", async () => {
      const { calls, clock, store } = rig();
      render(
        <FixedPresentationMode presenting>
          <Lens store={store} />
        </FixedPresentationMode>
      );
      expect(failedNotice()).toBeNull();

      await act(async () => calls[0].reject(new Error("HTTP 503")));
      expect(failedNotice()).toBeInTheDocument();

      clock.t += 15_000;
      act(() => store.ensureFresh());
      expect(calls).toHaveLength(2);
      expect(failedNotice()).toBeInTheDocument();

      await act(async () => calls[1].reject(new Error("HTTP 502")));
      expect(failedNotice()).toBeInTheDocument();

      clock.t += 15_000;
      act(() => store.ensureFresh());
      expect(failedNotice()).toBeInTheDocument();

      await act(async () =>
        calls[2].resolve({
          first_party_owners: ["qontinui"],
          confidential_terms: [],
        } as unknown as PresentationScopeRecord)
      );
      expect(failedNotice()).toBeNull();
    });
  });

  describe("beside the live toggle", () => {
    function live(state: PresentationScopeState) {
      return (
        <PresentationModeProvider>
          <PresentationScopeProvider state={state}>
            <PresentationModeToggle />
          </PresentationScopeProvider>
        </PresentationModeProvider>
      );
    }

    function renderLive(search: string, state: PresentationScopeState) {
      window.history.replaceState(null, "", `/admin/coord${search}`);
      return render(live(state));
    }

    afterEach(() => {
      window.sessionStorage.clear();
      window.localStorage.clear();
      window.history.replaceState(null, "", "/");
    });

    it("says every title is withheld while presenting", () => {
      renderLive("?present=1", FAILED);
      expect(screen.getByTestId("presentation-mode-toggle")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(failedNotice()).toHaveTextContent(
        "Titles withheld: scope unknown"
      );
    });

    it.each<[string, PresentationScopeState]>([
      ["failed", FAILED],
      ["with no first-party owners", NO_OWNERS],
    ])(
      "says nothing in the operator view, where nothing is withheld, on a scope %s",
      (_name, state) => {
        renderLive("?present=0", state);
        expect(screen.getByTestId("presentation-mode-toggle")).toHaveAttribute(
          "aria-pressed",
          "false"
        );
        expect(failedNotice()).toBeNull();
        expect(noOwnersNotice()).toBeNull();
      }
    );

    it("keeps the same control, focus and all, as the notice comes and goes", () => {
      const ready: PresentationScopeState = {
        status: "ready",
        scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
      };
      const { rerender } = renderLive("?present=1", ready);
      const toggle = screen.getByTestId("presentation-mode-toggle");
      toggle.focus();

      rerender(live(FAILED));
      expect(failedNotice()).toBeInTheDocument();
      expect(screen.getByTestId("presentation-mode-toggle")).toBe(toggle);
      expect(document.activeElement).toBe(toggle);
      // Ahead of the control, so the control keeps the row's far end.
      expect(
        failedNotice()!.compareDocumentPosition(toggle) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      rerender(live(ready));
      expect(failedNotice()).toBeNull();
      expect(screen.getByTestId("presentation-mode-toggle")).toBe(toggle);
      expect(document.activeElement).toBe(toggle);
    });
  });
});
