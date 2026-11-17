/**
 * The component actions panel's row keys while presenting (plan
 * `2026-10-23-console-presentation-spaces` D3.3): a row's `data-row-key` is an
 * alias of the component's own key, never its id, and the alias follows the
 * component — so a refresh that lists a component above the open one never
 * opens that other component in front of the audience.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { BUILD_ID, GIT_SHA } from "../__fixtures__/runnerBodies";
import {
  readComponents,
  type ComponentsReading,
} from "../_lib/componentEffectStatus";
import { ComponentActionsPanel } from "./ComponentActionsPanel";

const SCOPE = {
  status: "ready" as const,
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Partner A"] },
};

const BUILD = { state: "known", buildId: BUILD_ID, gitSha: GIT_SHA } as const;

/** A component registry as the runner would serve it, ids in order. */
function reading(ids: string[]): ComponentsReading {
  return readComponents({
    components: ids.map((id) => ({
      id,
      name: `${id} panel`,
      actions: [{ id: "open", label: "Open", effect: "read" }],
    })),
    wrapperComponents: "withheld",
  })!;
}

const panel = (ids: string[]) => (
  <ComponentActionsPanel
    components={{
      state: "ok",
      value: reading(ids),
      stale: false,
      asOf: 1761210000000,
    }}
    build={BUILD}
    noRunner={null}
  />
);

const rows = () => screen.getAllByTestId("coord-ui-bridge-component-row");

/** Whether a record row is expanded: its row line's own `aria-expanded`. */
const isOpen = (row: HTMLElement): boolean =>
  row.querySelector("[data-console-row]")?.getAttribute("aria-expanded") ===
  "true";

describe("the component actions panel's row keys while presenting", () => {
  it("never opens another component when a refresh lists one above the open row", () => {
    const view = renderInPresentationMode(panel(["partner-a-settings"]), {
      scope: SCOPE,
    });
    fireEvent.click(within(rows()[0]!).getAllByRole("button")[0]!);
    expect(isOpen(rows()[0]!)).toBe(true);
    view.rerender(panel(["acme-billing", "partner-a-settings"]));
    expect(rows()).toHaveLength(2);
    // The component that moved into the open row's old place stays closed.
    expect(isOpen(rows()[0]!)).toBe(false);
    for (const r of rows()) {
      expect(r.getAttribute("data-row-key") ?? "").not.toMatch(/acme|partner/i);
    }
    expectPresentationSafe(view, {
      forbidden: ["acme-billing", "partner-a-settings"],
    });
  });

  it("keeps the open row open when a refresh adds a component below it", () => {
    const view = renderInPresentationMode(panel(["partner-a-settings"]), {
      scope: SCOPE,
    });
    fireEvent.click(within(rows()[0]!).getAllByRole("button")[0]!);
    view.rerender(panel(["partner-a-settings", "acme-billing"]));
    expect(rows().map(isOpen)).toEqual([true, false]);
  });
});
