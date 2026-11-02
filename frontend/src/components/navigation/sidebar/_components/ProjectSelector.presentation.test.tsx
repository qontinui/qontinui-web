/**
 * The app sidebar's project selector beside a lens page (plan
 * `2026-10-23-console-presentation-spaces` D3.3).
 *
 * While presenting, the home page's tenant strip withholds the active
 * project's name ("Tenant: Project"). The selector used to render that same
 * name verbatim in its presenting branch — text, `title` and all — so a
 * screen share showed the confidential name in the sidebar beside a body
 * that had just withheld it. Each surface the selector has is held here to
 * one rule: while presenting the name is absent from the text AND from every
 * attribute of every element (portalled tooltip content included); in the
 * operator view it is present. Attributes are scanned here directly, because
 * the shared presentation helper's identity check reads only text-bearing
 * attributes, not `href` or data attributes.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { attributesNaming } from "@/test/attributesNaming";

const fx = vi.hoisted(() => ({
  ACTIVE: "Acme Corp rollout",
  OTHER: "Globex pilot",
  setActiveTenantId: vi.fn(),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [
      { id: "tenant-7f3c-acme", name: fx.ACTIVE, slug: "acme-corp-rollout" },
      { id: "tenant-9d1e-globex", name: fx.OTHER, slug: "globex-pilot" },
    ],
    activeTenantId: "tenant-7f3c-acme",
    setActiveTenantId: fx.setActiveTenantId,
  }),
}));
vi.mock("@/components/admin/coord/CoordProjectCreateDialog", () => ({
  CoordProjectCreateDialog: () => null,
}));

import { ProjectSelector } from "./ProjectSelector";

function renderIn(presenting: boolean, ui: ReactElement) {
  return render(
    <FixedPresentationMode presenting={presenting}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </FixedPresentationMode>
  );
}

/** The whole document — tooltips portal out of the render's container. */
function page(): { text: string; attributes: string[] } {
  return {
    text: document.body.textContent ?? "",
    attributes: [
      ...attributesNaming(document.body, fx.ACTIVE),
      ...attributesNaming(document.body, fx.OTHER),
      // The slug and id identify the project as surely as its name does.
      ...attributesNaming(document.body, "acme-corp-rollout"),
      ...attributesNaming(document.body, "globex-pilot"),
      ...attributesNaming(document.body, "tenant-7f3c-acme"),
      ...attributesNaming(document.body, "tenant-9d1e-globex"),
    ],
  };
}

async function openCollapsedTooltip() {
  await userEvent.hover(
    document.querySelector('[data-ui-bridge-id="coord.tenant-switcher"]')!
  );
  // Radix renders the content twice (visible + an a11y copy); either will do.
  return (await screen.findAllByRole("tooltip"))[0];
}

describe("ProjectSelector, expanded, while presenting", () => {
  it("withholds the active project's name from the text and from every attribute", () => {
    renderIn(true, <ProjectSelector isCollapsed={false} />);
    const presented = screen.getByTestId("coord-project-presented");
    // The strip's own rendering: the descriptor, through RedactedText.
    expect(presented).toHaveTextContent("Active project: Project");
    expect(presented.querySelector('[data-redacted="true"]')).not.toBeNull();
    const { text, attributes } = page();
    expect(text).not.toContain(fx.ACTIVE);
    expect(text).not.toContain(fx.OTHER);
    expect(attributes).toEqual([]);
  });

  it("offers no project change: no select, no menu, no options, no New project", async () => {
    renderIn(true, <ProjectSelector isCollapsed={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // Clicking the line opens nothing.
    await userEvent.click(screen.getByTestId("coord-project-presented"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    expect(
      document.querySelector('[data-ui-bridge-id^="coord.tenant-switcher-"]')
    ).toBeNull();
    expect(fx.setActiveTenantId).not.toHaveBeenCalled();
  });
});

describe("ProjectSelector, collapsed, while presenting", () => {
  it("withholds the name from the rail icon's tooltip", async () => {
    renderIn(true, <ProjectSelector isCollapsed />);
    const tooltip = await openCollapsedTooltip();
    expect(tooltip).toHaveTextContent("Active project: Project");
    const { text, attributes } = page();
    expect(text).not.toContain(fx.ACTIVE);
    expect(attributes).toEqual([]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("ProjectSelector in the operator view", () => {
  it("expanded: the switcher names the active project and offers the others", async () => {
    renderIn(false, <ProjectSelector isCollapsed={false} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent(fx.ACTIVE);
    expect(screen.getByTestId("coord-project-new")).toBeInTheDocument();
  });

  it("collapsed: the rail icon's tooltip names the active project", async () => {
    renderIn(false, <ProjectSelector isCollapsed />);
    const tooltip = await openCollapsedTooltip();
    expect(tooltip).toHaveTextContent(`Project: ${fx.ACTIVE}`);
  });
});
