/**
 * Whether check (b) read the registry the checked render registers with (plan
 * `2026-10-23-console-presentation-spaces` D3.2; `uiBridgeBinding.ts`). Each
 * row is a view, built the way a test builds one, and how the binding reads
 * it: `provider` only for the render whose registry the helper read back,
 * with no other UI Bridge provider in its tree; a reason check (b) reports
 * for every view it can tell is not.
 */

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { UIBridgeProvider } from "@qontinui/ui-bridge/react";
import { renderInPresentationMode } from "./presentation";
import { markProviderReadBack, registryBinding } from "./uiBridgeBinding";

function Page() {
  return <main>Fleet health</main>;
}

describe("registryBinding", () => {
  it("binds the registry the helper read back to its own render, and to a copy of its view", () => {
    const view = renderInPresentationMode(<Page />);
    expect(registryBinding(view)).toEqual({
      observation: "provider",
      unread: null,
    });
    expect(registryBinding({ ...view, baseElement: view.container })).toEqual({
      observation: "provider",
      unread: null,
    });
  });

  it("refuses another render's registry", () => {
    const page = renderInPresentationMode(<Page />);
    const other = renderInPresentationMode(<p>other</p>);
    const binding = registryBinding({ ...page, uiBridge: other.uiBridge });
    expect(binding.observation).toBe("another-render");
    expect(binding.unread).toContain("registry of another render");
  });

  it("refuses a render whose tree holds a UIBridgeProvider of its own, wherever it is", () => {
    const wrapped = renderInPresentationMode(<Page />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <UIBridgeProvider>{children}</UIBridgeProvider>
      ),
    });
    expect(registryBinding(wrapped)).toMatchObject({
      observation: "another-provider",
      unread: expect.stringContaining("mounts a UIBridgeProvider of its own"),
    });
    const twice = renderInPresentationMode(
      <>
        <UIBridgeProvider>
          <Page />
        </UIBridgeProvider>
        <UIBridgeProvider>
          <Page />
        </UIBridgeProvider>
      </>
    );
    expect(registryBinding(twice).unread).toContain(
      "mounts 2 UIBridgeProviders of its own"
    );
  });

  it("ties nothing to a view without a container, or to one unmounted — and leaves those to check (f)", () => {
    const view = renderInPresentationMode(<Page />);
    expect(registryBinding({ uiBridge: view.uiBridge })).toEqual({
      observation: "unbound",
      unread: null,
    });
    view.unmount();
    expect(registryBinding(view)).toEqual({
      observation: "unbound",
      unread: null,
    });
  });

  it("fails closed on a mounted render in whose tree the read-back's provider cannot be found", () => {
    const view = renderInPresentationMode(<Page />);
    const observed = { registry: { getAllComponents: () => [] } };
    markProviderReadBack(observed, {
      container: view.container,
      registry: {},
      // A provider this tree never rendered: as if React stopped naming it.
      provider: function NotInTheTree() {
        return null;
      },
    });
    const binding = registryBinding({ ...view, uiBridge: observed });
    expect(binding.observation).toBe("unbound");
    expect(binding.unread).toContain("cannot find");
  });

  it("reads a registry view the test supplied as the caller's, and an unobservable one as such", () => {
    const view = renderInPresentationMode(<Page />, {
      uiBridge: {
        registry: { getAllComponents: () => [], getAllElements: () => [] },
      },
    });
    expect(registryBinding(view)).toEqual({
      observation: "caller",
      unread: null,
    });
    expect(
      registryBinding({ ...view, uiBridge: { unobservable: "mocked" } })
    ).toEqual({ observation: "unobservable", unread: null });
  });
});
