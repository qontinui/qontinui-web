/**
 * The drawer's navigation buttons: each closes the drawer and hands off to the
 * page — Ask the Twin with a question about the row, or the Delivery tab — and
 * only rows that are really askable that way get one. The Dialog is stubbed
 * to a plain open/closed switch; the page-level walk in `page.test.tsx`
 * drives the real one.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import manifest from "../_lib/subspaces.manifest.json";
import {
  TwinNavigationContext,
  type TwinNavigation,
} from "../_lib/twin-navigation";
import type { ResolvedSubspace, SubspaceManifestEntry } from "../_lib/types";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

import { SubspaceDetail } from "./SubspaceDetail";

function rowFor(id: string): ResolvedSubspace {
  const entry = (manifest.subspaces as SubspaceManifestEntry[]).find(
    (r) => r.id === id
  );
  if (!entry) throw new Error(`no manifest row ${id}`);
  return { ...entry, cellStatus: "interactive" };
}

function Harness({
  rowId,
  navigation,
}: {
  rowId: string;
  navigation: TwinNavigation;
}) {
  const [row, setRow] = useState<ResolvedSubspace | null>(null);
  return (
    <TwinNavigationContext.Provider value={navigation}>
      <button onClick={() => setRow(rowFor(rowId))}>open cell</button>
      <SubspaceDetail
        row={row}
        onOpenChange={(open) => !open && setRow(null)}
      />
    </TwinNavigationContext.Provider>
  );
}

function nav(overrides: Partial<TwinNavigation> = {}): TwinNavigation {
  return { askTheTwin: vi.fn(), openTab: vi.fn(), ...overrides };
}

describe("SubspaceDetail navigation", () => {
  it("closes the drawer and hands a question about the row to Ask the Twin", async () => {
    const navigation = nav();
    const user = userEvent.setup();
    render(<Harness rowId="gates" navigation={navigation} />);

    await user.click(screen.getByRole("button", { name: "open cell" }));
    await user.click(
      screen.getByRole("button", { name: /ask the twin about this/i })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.askTheTwin).toHaveBeenCalledWith(
      expect.stringMatching(/gates sub-space.*coord_gate_list/)
    );
  });

  it("offers no button for a row this page cannot ask, or a claim-only one", async () => {
    const user = userEvent.setup();
    for (const id of ["ast", "fs"]) {
      const { unmount } = render(<Harness rowId={id} navigation={nav()} />);
      await user.click(screen.getByRole("button", { name: "open cell" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /ask the twin about this/i }),
        id
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /open the delivery tab/i }),
        id
      ).toBeNull();
      unmount();
    }
  });

  it("opens the Delivery tab for the delivery row", async () => {
    const navigation = nav();
    const user = userEvent.setup();
    render(<Harness rowId="delivery" navigation={navigation} />);

    await user.click(screen.getByRole("button", { name: "open cell" }));
    await user.click(
      screen.getByRole("button", { name: /open the delivery tab/i })
    );

    expect(navigation.openTab).toHaveBeenCalledWith("delivery");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
