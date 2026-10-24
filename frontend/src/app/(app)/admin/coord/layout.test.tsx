/**
 * The console layout mounts the presentation lens (plan
 * `2026-10-23-console-presentation-spaces` Phase 1 Arming: "a console page
 * loaded with `?present=1` renders captions and no write control").
 *
 * Two kinds of console page, because presentation mode treats them
 * differently (`PresentationPage`, D3 "fails closed by construction"):
 *
 * - a page NOT registered as presentation-ready is withheld — its body never
 *   renders, its caption and a plain "operator view only" statement stand in;
 * - a page registered as ready renders, and the lens primitives inside it do
 *   their work: `OperatorOnly` unmounts the write control, `RedactedText`
 *   withholds what the tenant's scope does not clear.
 *
 * The page body here is the lens primitives a real page composes; which
 * routes are "ready" is the test's to say (`readiness.routes`), through the
 * real `isPresentationReady`. The header's live-badge row and the red-main
 * banner fetch, and are covered by their own suites (the banner under the
 * real layout in `layout.present-url.population.test.tsx`), so they are
 * stubbed to what they render that matters here — a navigation link, and
 * nothing. The lens's one read, the tenant's presentation scope, is stubbed
 * at its client, so the REAL loader inside the layout carries the scope to the
 * page's titles.
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
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  useUIComponent,
} from "@qontinui/ui-bridge/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
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

/** Which routes the test declares presentation-ready. */
const readiness = vi.hoisted(() => ({
  routes: [] as PresentationReadyRoute[],
}));
vi.mock(
  "@/components/presentation/presentationReadiness",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/components/presentation/presentationReadiness")
      >();
    return {
      ...real,
      isPresentationReady: (pathname: string) =>
        real.isPresentationReady(pathname, readiness.routes),
    };
  }
);

const DEVOPS_READY: PresentationReadyRoute = {
  route: "/admin/coord/devops",
  provenBy: "app/(app)/admin/coord/layout.test.tsx",
};

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
  WITHHELD_PAGE_TITLE,
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

function setUrl(search: string, path = "/admin/coord/devops") {
  window.history.replaceState(null, "", `${path}${search}`);
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
  readiness.routes = [];
  setUrl("");
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — a console page not prepared for presentation", () => {
  it("withholds the page behind its caption on a console page loaded with ?present=1, with no write control", () => {
    setUrl("?present=1");
    const { holder } = renderConsole();

    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "true");
    // The surface's caption, and an honest statement — not the page.
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("12 machines")).not.toBeInTheDocument();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    // Withheld means NOT RENDERED: the page's write action never registered.
    expect(holder.registry!.getAllComponents().map((c) => c.id)).not.toContain(
      "layout-test-drain"
    );
    expect(
      findPresentationViolations(
        { uiBridge: { registry: holder.registry! } },
        { captions: ["dev-ops.page"] }
      )
    ).toEqual([]);
  });

  it("withholds a console page that is not a lens surface too, without a caption to stand in", () => {
    setUrl("?present=1", "/admin/coord/pipeline");
    renderConsole();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("12 machines")).not.toBeInTheDocument();
    // The page's own Caption is part of the withheld body; the placeholder has
    // no surface caption for a route outside the five lens surfaces.
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();
  });

  it("is the operator console when not presenting, and the header toggle withholds the page", () => {
    renderConsole();
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();
    expect(screen.getByText("12 machines")).toBeInTheDocument();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
  });
});

describe("CoordLayout — a console page registered as presentation-ready", () => {
  beforeEach(() => {
    readiness.routes = [DEVOPS_READY];
  });

  it("renders the page's captions and no write control on a console page loaded with ?present=1", () => {
    setUrl("?present=1");
    const { holder } = renderConsole();

    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText("12 machines")).toBeInTheDocument();
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(
      findPresentationViolations(
        { uiBridge: { registry: holder.registry! } },
        { captions: ["dev-ops.page"] }
      )
    ).toEqual([]);
  });

  it("switches from the operator console with the header toggle", () => {
    renderConsole();
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(screen.getByText("12 machines")).toBeInTheDocument();
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
});

describe("CoordLayout — operator mode and chrome", () => {
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
