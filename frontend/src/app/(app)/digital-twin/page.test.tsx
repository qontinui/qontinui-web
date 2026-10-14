/**
 * The Explorer's tab contract, walked by Spec CI's own ids.
 *
 * Like the sibling `page.specSelectors.test.tsx` files, this READS the
 * committed `specs/pages/digital-twin/state-machine.derived.json` at test time
 * and holds no copy of its ids: it resolves every `id` criterion of the
 * initial-render states, then walks every transition in spec order — on one
 * page load, as Spec CI does — with the spec's own route-stub bodies as the
 * data. The two `role: heading` criteria are not checked here: they resolve
 * through content discovery rather than an id, and one of them is the Ask the
 * Twin panel, which this file mocks out.
 *
 * The UI Bridge is modelled as the registry Spec CI's matcher reads: an id
 * resolves to the element its `useUIElement` ref is attached to, and only while
 * that element is mounted. Two mounted elements registering one id fail the
 * test, because the real registry cannot tell them apart. That is what makes
 * the Lifecycle tab's contract checkable: switching to it mounts the stage
 * pipeline while UNMOUNTING the matrix (Radix Tabs unmounts inactive content),
 * so the two views register different ids for the same row and never collide.
 *
 * A jsdom render is not a browser and is not the Spec CI executor; Spec CI's
 * own run stays the authoritative check.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubspacesProbeResponse } from "./_lib/types";

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  /** Raw verdict bodies by sub-space id (the drawer's `useSubspaceRaw`). */
  rawById: {} as Record<string, unknown>,
  /** The delivery verdict body a submitted lookup resolves to. */
  delivery: undefined as unknown,
  /** The UI Bridge registry: the mounted element per id. */
  registry: new Map<string, HTMLElement>(),
  /** Ids registered by two mounted elements at once. */
  duplicates: [] as string[],
  /** Every draft the page handed the (mocked) Ask the Twin panel. */
  askDrafts: [] as string[],
}));

vi.mock("./_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("./_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: (id: string | null, enabled: boolean) => ({
    data: enabled && id ? state.rawById[id] : undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("./_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: (slug: string) => ({
    data: slug.trim() ? state.delivery : undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: ({ id }: { id: string }) => ({
    ref: (el: HTMLElement | null) => {
      if (!el) {
        state.registry.delete(id);
        return;
      }
      const prior = state.registry.get(id);
      if (prior && prior !== el && prior.isConnected) {
        state.duplicates.push(id);
      }
      state.registry.set(id, el);
    },
  }),
}));
// Panels no transition drives and no `id` criterion names: coord's catalog,
// and the runner-only Ask the Twin and UI Bridge panels (Spec CI runs with no
// connected runner).
vi.mock("./_components/TwinCatalog", () => ({ TwinCatalog: () => null }));
vi.mock("./_components/AskTheTwin", () => ({
  AskTheTwin: ({ draft }: { draft?: string | null }) => {
    if (draft) state.askDrafts.push(draft);
    return null;
  },
}));
vi.mock("./_components/UiBridgePanel", () => ({ UiBridgePanel: () => null }));

import DigitalTwinPage from "./page";

interface SpecAction {
  type: string;
  target: { id: string };
  params?: { text?: string };
  waitAfter?: { type: string; query?: { id: string } };
}
interface DerivedSpec {
  states: {
    id: string;
    assertions: { id: string; target?: { criteria?: { id?: string } } }[];
  }[];
  transitions: { id: string; actions: SpecAction[] }[];
  metadata: { routeStubs: { urlPattern: string; body: unknown }[] };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../specs/pages/digital-twin/state-machine.derived.json"
    ),
    "utf-8"
  )
);

/** The body the spec stubs `urlPattern` with. */
function stubBody(urlPattern: string): unknown {
  const stub = SPEC.metadata.routeStubs.find(
    (s) => s.urlPattern === urlPattern
  );
  if (!stub) throw new Error(`the spec stubs no route ${urlPattern}`);
  return stub.body;
}

/** Every `id` criterion the initial-render states assert. */
function initialRenderIds(stateId?: string): string[] {
  return SPEC.states
    .filter((s) => stateId === undefined || s.id === stateId)
    .flatMap((s) => s.assertions)
    .map((a) => a.target?.criteria?.id)
    .filter((id): id is string => id !== undefined);
}

function isMounted(id: string): boolean {
  return state.registry.get(id)?.isConnected === true;
}

/** The mounted element the registry holds for `id`; throws when none is. */
function registered(id: string): HTMLElement {
  const el = state.registry.get(id);
  if (!el?.isConnected) throw new Error(`no mounted UI Bridge element ${id}`);
  return el;
}

/** Perform one spec action, then wait for its `waitAfter` element. */
async function perform(
  user: ReturnType<typeof userEvent.setup>,
  action: SpecAction
): Promise<void> {
  const target = registered(action.target.id);
  if (action.type === "click") {
    await user.click(target);
  } else if (action.type === "type") {
    await user.type(target, action.params?.text ?? "");
  } else {
    throw new Error(`this walker does not perform "${action.type}" actions`);
  }
  const awaited = action.waitAfter?.query?.id;
  if (action.waitAfter?.type === "element" && awaited) {
    await waitFor(() => expect(isMounted(awaited), awaited).toBe(true));
  }
}

beforeEach(() => {
  state.probe = {
    data: stubBody(
      "**/api/v1/digital-twin/subspaces"
    ) as SubspacesProbeResponse,
    isLoading: false,
    isError: false,
    error: null,
  };
  state.rawById = {
    schema: stubBody("**/api/v1/digital-twin/subspace/schema/raw"),
  };
  state.delivery = stubBody("**/api/v1/digital-twin/delivery/verdict**");
  state.registry.clear();
  state.duplicates = [];
  state.askDrafts = [];
});

describe("DigitalTwinPage tabs", () => {
  it("orders the tabs Completeness, Lifecycle, Delivery, UI Bridge", () => {
    render(<DigitalTwinPage />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Completeness",
      "Lifecycle",
      "Delivery",
      "UI Bridge",
    ]);
  });

  it("registers every id the spec's initial-render states assert", () => {
    render(<DigitalTwinPage />);
    const ids = initialRenderIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !isMounted(id))).toEqual([]);
    expect(state.duplicates).toEqual([]);
  });

  it("walks every Spec CI transition in spec order, by the spec's own ids", async () => {
    // The Lifecycle tab's transition is one of them, ahead of the drawer.
    const order = SPEC.transitions.map((t) => t.id);
    expect(order).toContain("digital-twin-lifecycle-view");
    expect(order.indexOf("digital-twin-lifecycle-view")).toBeLessThan(
      order.indexOf("digital-twin-open-drawer")
    );

    const user = userEvent.setup();
    render(<DigitalTwinPage />);
    for (const transition of SPEC.transitions) {
      for (const action of transition.actions) {
        await perform(user, action);
      }
    }
    expect(state.duplicates).toEqual([]);
  });

  it("unmounts the matrix while Lifecycle is open, so no row's id is registered twice", async () => {
    const lifecycle = SPEC.transitions.find(
      (t) => t.id === "digital-twin-lifecycle-view"
    )!;
    const user = userEvent.setup();
    render(<DigitalTwinPage />);

    // The transition's first action switches to the Lifecycle tab.
    await perform(user, lifecycle.actions[0]!);
    const matrixIds = initialRenderIds("digital-twin-matrix");
    expect(matrixIds.length).toBeGreaterThan(0);
    for (const id of matrixIds) {
      // The matrix cell is gone, and its row is present under stage-scoped ids.
      expect(isMounted(id), id).toBe(false);
      const row = id.replace(/^digital-twin-cell-/, "");
      const scoped = Array.from(state.registry.keys()).filter((key) =>
        new RegExp(`^digital-twin-stage-[a-z]+-cell-${row}$`).test(key)
      );
      expect(scoped.length, row).toBeGreaterThan(0);
    }
    expect(state.duplicates).toEqual([]);
  });
});

describe("DigitalTwinPage drawer navigation", () => {
  it("opens Completeness with a question for an Ask-the-Twin row, from the Lifecycle tab", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinPage />);

    await user.click(registered("digital-twin-tab-lifecycle"));
    const gatesCell = await waitFor(() => {
      const id = Array.from(state.registry.keys()).find((key) =>
        /^digital-twin-stage-[a-z]+-cell-gates$/.test(key)
      );
      expect(id).toBeDefined();
      return registered(id!);
    });
    await user.click(gatesCell);
    await user.click(registered("digital-twin-drawer-ask"));

    // The drawer closed, the matrix is back, and the question was handed over.
    await waitFor(() =>
      expect(isMounted("digital-twin-cell-schema")).toBe(true)
    );
    expect(isMounted("digital-twin-drawer-ask")).toBe(false);
    expect(state.askDrafts.at(-1)).toMatch(/gates sub-space/);
    expect(state.askDrafts.at(-1)).toMatch(/coord_/);
    expect(state.duplicates).toEqual([]);
  });

  it("opens the Delivery tab for the delivery row", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinPage />);

    await user.click(registered("digital-twin-cell-delivery"));
    expect(isMounted("digital-twin-drawer-ask")).toBe(false);
    await user.click(registered("digital-twin-drawer-open-delivery"));

    await waitFor(() =>
      expect(isMounted("digital-twin-delivery-input")).toBe(true)
    );
    expect(state.askDrafts).toEqual([]);
  });

  it("offers no action for a row this page cannot ask, or a live-probed one", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinPage />);

    for (const id of ["ast", "schema"]) {
      await user.click(registered(`digital-twin-cell-${id}`));
      await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
      expect(isMounted("digital-twin-drawer-ask"), id).toBe(false);
      expect(isMounted("digital-twin-drawer-open-delivery"), id).toBe(false);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });
});
