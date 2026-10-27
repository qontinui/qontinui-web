/**
 * OperatorOnly (plan `2026-10-23-console-presentation-spaces` D3.2, "no write
 * control"): in presentation mode its children are NOT RENDERED — no DOM, and
 * no UI Bridge registration an automated walk could fire.
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  useUIComponent,
} from "@qontinui/ui-bridge/react";
import { OperatorOnly } from "./OperatorOnly";
import { FixedPresentationMode } from "./PresentationModeProvider";

function DrainLever() {
  useUIComponent({
    id: "test-drain-lever",
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

type Registry = NonNullable<ReturnType<typeof useUIBridgeOptional>>["registry"];

/**
 * Hands the test the real registry. It is READ after RTL's act-wrapped render
 * returns, because `useUIComponent` registers and unregisters in passive
 * effects, which have flushed by then.
 */
function RegistryProbe({ holder }: { holder: { registry: Registry | null } }) {
  holder.registry = useUIBridgeOptional()?.registry ?? null;
  return null;
}

function inLens(presenting: boolean | null, ui: ReactNode) {
  return presenting === null ? (
    ui
  ) : (
    <FixedPresentationMode presenting={presenting}>{ui}</FixedPresentationMode>
  );
}

describe("OperatorOnly", () => {
  it("renders its children in operator mode", () => {
    render(
      inLens(
        false,
        <OperatorOnly>
          <button type="button">Drain this machine</button>
        </OperatorOnly>
      )
    );
    expect(
      screen.getByRole("button", { name: "Drain this machine" })
    ).toBeInTheDocument();
  });

  it("renders its children where no lens is mounted — that page has no presentation mode", () => {
    render(
      inLens(
        null,
        <OperatorOnly>
          <button type="button">Drain this machine</button>
        </OperatorOnly>
      )
    );
    expect(
      screen.getByRole("button", { name: "Drain this machine" })
    ).toBeInTheDocument();
  });

  it("renders nothing of them in presentation mode", () => {
    render(
      inLens(
        true,
        <OperatorOnly>
          <button type="button">Drain this machine</button>
        </OperatorOnly>
      )
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
  });

  it("renders the placeholder in their place in presentation mode", () => {
    render(
      inLens(
        true,
        <OperatorOnly
          placeholder={<a href="/admin/coord/runners">Where drains live</a>}
        >
          <button type="button">Drain this machine</button>
        </OperatorOnly>
      )
    );
    expect(
      screen.getByRole("link", { name: "Where drains live" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("unregisters the children's UI Bridge write actions in presentation mode", () => {
    const holder: { registry: Registry | null } = { registry: null };
    const ids = () =>
      (holder.registry?.getAllComponents() ?? []).map((c) => c.id);
    const tree = (presenting: boolean) => (
      <UIBridgeProvider>
        <RegistryProbe holder={holder} />
        {inLens(
          presenting,
          <OperatorOnly>
            <DrainLever />
          </OperatorOnly>
        )}
      </UIBridgeProvider>
    );

    const { rerender } = render(tree(false));
    expect(holder.registry).not.toBeNull();
    expect(ids()).toContain("test-drain-lever");

    rerender(tree(true));
    expect(ids()).not.toContain("test-drain-lever");
  });
});
