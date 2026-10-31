/**
 * The phone-width top bar — the app shell's header — beside a lens page
 * (plan `2026-10-23-console-presentation-spaces` D3.3).
 *
 * It names the active project. While presenting, that name is withheld the
 * same way the home page's tenant strip withholds it ("Project"): absent from
 * the text and from every attribute. The operator still reads it.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";
import { attributesNaming } from "@/test/attributesNaming";

const fx = vi.hoisted(() => ({ ACTIVE: "Acme Corp rollout" }));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: "t-active", name: fx.ACTIVE, slug: "acme-corp-rollout" }],
    activeTenantId: "t-active",
    setActiveTenantId: vi.fn(),
  }),
}));
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebar: () => ({
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    menuButtonRef: { current: null },
  }),
}));

import { MobileTopBar } from "./MobileTopBar";

function renderIn(presenting: boolean) {
  return render(
    <FixedPresentationMode presenting={presenting}>
      <MobileTopBar />
    </FixedPresentationMode>
  );
}

describe("MobileTopBar", () => {
  it("withholds the active project's name while presenting", () => {
    const { container } = renderIn(true);
    const name = container.querySelector(
      '[data-ui-bridge-id="shell.mobile-top-bar.project-name"]'
    );
    expect(name).toHaveTextContent("Project");
    expect(container.textContent).not.toContain(fx.ACTIVE);
    expect(attributesNaming(document.body, fx.ACTIVE)).toEqual([]);
    expect(attributesNaming(document.body, "acme-corp-rollout")).toEqual([]);
    expect(attributesNaming(document.body, "t-active")).toEqual([]);
  });

  it("names the active project in the operator view", () => {
    renderIn(false);
    expect(screen.getByText(fx.ACTIVE)).toBeInTheDocument();
  });
});
