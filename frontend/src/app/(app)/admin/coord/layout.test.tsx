/**
 * The console layout mounts the presentation lens (plan
 * `2026-10-23-console-presentation-spaces` Phase 1 Arming: "a console page
 * loaded with `?present=1` renders captions and no write control").
 *
 * The page body here is the lens primitives a real page composes; the
 * layout's own chrome (the header and its toggle) is under test with it. The
 * header's live-badge row and the red-main banner fetch, and are covered by
 * their own suites, so they are stubbed to what they render that matters here
 * — a navigation link, and nothing. The lens's one read, the tenant's
 * presentation scope, is stubbed at its client, so the REAL loader inside the
 * layout carries the scope to the page's titles.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationScopeRecord } from "@/lib/api/presentationScope";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  useUIComponent,
} from "@qontinui/ui-bridge/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/admin/coord/CoordNav", () => ({
  default: () => (
    <nav data-testid="coord-nav">
      <a href="/admin/coord/notifications">Notifications</a>
    </nav>
  ),
}));
vi.mock("@/components/admin/coord/RedMainBanner", () => ({
  default: () => null,
}));

const SCOPE: PresentationScopeRecord = {
  tenant_id: "00000000-0000-0000-0000-00000000000a",
  first_party_owners: ["qontinui"],
  first_party_owners_source: "registered_repos",
  first_party_owners_unknown_reason: null,
  confidential_terms: ["Acme Corp"],
  configured: {
    first_party_owners: null,
    confidential_terms: [],
    version: 0,
    updated_at: null,
    updated_by: null,
  },
  defaults: {
    registered_repo_owners: ["qontinui"],
    registered_repo_owners_unknown_reason: null,
    viewer_other_tenant_names: ["Acme Corp"],
  },
  can_edit: false,
};

const scopeClient = vi.hoisted(() => ({
  fetchPresentationScope: vi.fn(),
  savePresentationScope: vi.fn(),
}));
vi.mock("@/lib/api/presentationScope", () => scopeClient);

import CoordLayout from "./layout";
import {
  Caption,
  OperatorOnly,
  RedactedText,
  defaultPresentationModeStore,
  defaultPresentationScopeStore,
} from "@/components/presentation";
import { findPresentationViolations } from "@/test/presentation";

type Registry = NonNullable<ReturnType<typeof useUIBridgeOptional>>["registry"];

function DrainLever() {
  useUIComponent({
    id: "layout-test-drain",
    name: "Drain lever",
    actions: [
      {
        id: "drain",
        label: "Drain",
        effect: "write",
        handler: async () => true,
      },
    ],
  });
  return <button type="button">Drain this machine</button>;
}

function ConsolePage() {
  return (
    <div>
      <Caption id="dev-ops.page" />
      <p>12 machines</p>
      <RedactedText
        text="Ship the presentation lens"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan", status: "in progress" }}
        data-testid="first-party"
      />
      <RedactedText
        text="Rebuild the storefront"
        repo="client-co/storefront"
        descriptor={{ kind: "Plan", status: "draft" }}
        data-testid="foreign-owner"
      />
      <RedactedText
        text="Prepare the Acme Corp demo"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan", status: "draft" }}
        data-testid="confidential-term"
      />
      <OperatorOnly>
        <DrainLever />
      </OperatorOnly>
    </div>
  );
}

function renderConsole() {
  const holder: { registry: Registry | null } = { registry: null };
  function Probe() {
    holder.registry = useUIBridgeOptional()?.registry ?? null;
    return null;
  }
  const view = render(
    <UIBridgeProvider>
      <Probe />
      <CoordLayout>
        <ConsolePage />
      </CoordLayout>
    </UIBridgeProvider>
  );
  return { view, holder };
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/admin/coord/devops${search}`);
}

beforeEach(() => {
  // The layout shares the tab-wide stores, whose memory outlives a test: start
  // each one from an explicit operator choice and nothing read, then empty
  // storage.
  defaultPresentationModeStore.recordChoice(false, { remember: false });
  defaultPresentationScopeStore.invalidate();
  scopeClient.fetchPresentationScope.mockReset();
  scopeClient.fetchPresentationScope.mockResolvedValue(SCOPE);
  window.sessionStorage.clear();
  window.localStorage.clear();
  setUrl("");
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — the presentation lens", () => {
  it("renders captions and no write control on a console page loaded with ?present=1", () => {
    setUrl("?present=1");
    const { holder } = renderConsole();

    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(holder.registry).not.toBeNull();
    expect(
      findPresentationViolations(
        { uiBridge: { registry: holder.registry! } },
        { captions: ["dev-ops.page"] }
      )
    ).toEqual([]);
  });

  it("is the operator console when not presenting, and the header toggle switches the lens", () => {
    renderConsole();
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
  });

  it("redacts the page's titles by the tenant's scope, read once through the lens", async () => {
    setUrl("?present=1");
    renderConsole();
    // Unknown until read: every title withheld.
    expect(screen.getByTestId("first-party")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    await waitFor(() =>
      expect(screen.getByTestId("first-party")).toHaveTextContent(
        "Ship the presentation lens"
      )
    );
    expect(screen.getByTestId("foreign-owner")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    expect(
      screen.queryByText("Rebuild the storefront")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("confidential-term")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    expect(screen.queryByText(/Acme Corp/)).not.toBeInTheDocument();
    expect(scopeClient.fetchPresentationScope).toHaveBeenCalledTimes(1);
  });

  it("does not read the scope in operator mode, where nothing is redacted", async () => {
    renderConsole();
    expect(screen.getByText("Rebuild the storefront")).toBeInTheDocument();
    expect(screen.getByText("Prepare the Acme Corp demo")).toBeInTheDocument();
    // Let every effect and microtask run before asserting the absence.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(scopeClient.fetchPresentationScope).not.toHaveBeenCalled();
  });

  it("keeps the header title operators and specs assert on", () => {
    setUrl("?present=1");
    renderConsole();
    expect(
      screen.getByRole("heading", { level: 1, name: "Coord operator console" })
    ).toBeInTheDocument();
  });
});
