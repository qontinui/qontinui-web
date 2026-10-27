/**
 * Every UI Bridge registration on the twin's views exists only with its
 * element, in both modes, under the REAL SDK.
 *
 * `useUIElement` looks for a registration whose ref is not attached right
 * after mount. It polls the DOM for `[data-ui-bridge-id="<id>"]`, 3 tries
 * 100 ms apart (`pollForTaggedElement`, `@qontinui/ui-bridge` 0.35), and
 * unmounting does not stop the poll. So a hook registered for a button the
 * view does not render (a closed drawer's buttons, a raw-data toggle behind
 * `OperatorOnly` or before any verdict) leaves timers running past the view.
 * One that fires after the test environment is torn down throws
 * `document is not defined` into the run (seen in the full suite, from
 * `page.presentation-proof.test.tsx`). Each such button now registers in its
 * own component, where it renders (`SubspaceDetailActions.tsx`,
 * `DeliveryVerdictCard.tsx` `ShowRawToggle`).
 *
 * The poll is the SDK's only `document.querySelector` by that attribute, so
 * a spy on it sees each poll's first try, which runs in a microtask after
 * mount.
 */

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIBridgeProvider } from "@qontinui/ui-bridge/react";
import { FixedPresentationMode } from "@/components/presentation";
import { renderInPresentationMode } from "@/test/presentation";
import type {
  DeliveryVerdictResponse,
  RawVerdictResponse,
  SubspacesProbeResponse,
} from "../_lib/types";

const state = vi.hoisted(() => ({
  probe: {} as Record<string, unknown>,
  raw: {} as Record<string, unknown>,
  delivery: undefined as unknown,
}));

vi.mock("../_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("../_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => ({ data: undefined }),
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: (id: string | null, enabled: boolean) => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    ...(enabled && id ? (state.raw[id] as object) : undefined),
  }),
}));
vi.mock("../_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: (slug: string) => ({
    data: slug.trim() ? state.delivery : undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: slug.trim() ? Date.now() : 0,
  }),
}));

import { MANIFEST_SNAPSHOT_IDS } from "../_lib/test-catalog";
import {
  TwinNavigationContext,
  type TwinNavigation,
} from "../_lib/twin-navigation";
import { CoverageMatrix } from "./CoverageMatrix";
import { DeliveryVerdictCard } from "./DeliveryVerdictCard";
import { LifecycleView } from "./LifecycleView";

/** The selector the SDK's poll queries. */
const POLL_SELECTOR = /^\[data-ui-bridge-id=/;

/** Each poll the SDK started, by the selector of its first try. */
let polled: string[];

const NAVIGATION: TwinNavigation = { askTheTwin: () => {}, openTab: () => {} };

function Operator({ children }: { children: ReactNode }) {
  return (
    <UIBridgeProvider>
      <FixedPresentationMode presenting={false}>
        <TwinNavigationContext.Provider value={NAVIGATION}>
          {children}
        </TwinNavigationContext.Provider>
      </FixedPresentationMode>
    </UIBridgeProvider>
  );
}

const VIEWS = [
  ["the Completeness matrix", () => <CoverageMatrix />],
  ["the Lifecycle view", () => <LifecycleView />],
  ["the Delivery card", () => <DeliveryVerdictCard />],
] as const;

/** Let every effect's queued microtask run: the poll's first try is in one. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  polled = [];
  const query = document.querySelector.bind(document);
  vi.spyOn(document, "querySelector").mockImplementation(
    (selector: string) => {
      if (POLL_SELECTOR.test(selector)) polled.push(selector);
      return query(selector);
    }
  );
  state.probe = {
    data: {
      subspaces: MANIFEST_SNAPSHOT_IDS.map((id) => ({
        id,
        status: "implemented" as const,
      })),
      probed: MANIFEST_SNAPSHOT_IDS.length,
      restricted: false,
    } satisfies SubspacesProbeResponse,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
  };
  state.raw = {
    schema: {
      data: {
        subspace: "schema",
        tool: "coord_query_migration_state",
        verdict: {
          coverage: 1,
          credibility: 0.95,
          posterior: 0.9,
          staleness_seconds: 30,
          provenance: "alembic_graph",
          drift_class: "none",
        },
      } satisfies RawVerdictResponse,
      dataUpdatedAt: Date.now(),
    },
  };
  state.delivery = {
    subspace: "delivery",
    tool: "coord_query_delivery",
    verdict: {
      instance: "delivery",
      drift_class: "none",
      coverage: 1,
      credibility: 0.95,
      staleness_seconds: 0,
      provenance: "coord_delivery_join_live",
      components: { anchor_kind: "work_unit", slug: "a-unit", prs: [] },
    },
  } satisfies DeliveryVerdictResponse;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the twin's views register no UI Bridge element they do not render", () => {
  for (const [name, view] of VIEWS) {
    it(`${name} · operator`, async () => {
      render(view(), { wrapper: Operator });
      await settle();
      expect(polled).toEqual([]);
    });

    it(`${name} · presenting`, async () => {
      renderInPresentationMode(view());
      await settle();
      expect(polled).toEqual([]);
    });
  }
});

describe("a button the twin's views do render is registered with its element", () => {
  it("the drawer's open-Delivery, ask and raw-data buttons, for the rows that show them", async () => {
    render(<CoverageMatrix />, { wrapper: Operator });
    await settle();
    const opened: [row: string, id: string][] = [
      ["delivery", "digital-twin-drawer-open-delivery"],
      ["gates", "digital-twin-drawer-ask"],
      ["schema", "digital-twin-show-raw"],
    ];
    for (const [row, id] of opened) {
      fireEvent.click(screen.getByTestId(`digital-twin-cell-${row}`));
      const drawer = screen.getByRole("dialog");
      await settle();
      expect(
        drawer.querySelector(`[data-ui-bridge-id="${id}"]`),
        row
      ).toBeInstanceOf(HTMLButtonElement);
      fireEvent.keyDown(drawer, { key: "Escape" });
      await settle();
    }
    expect(polled).toEqual([]);
  });

  it("the Delivery card's raw-data toggle, once a verdict shows", async () => {
    render(<DeliveryVerdictCard />, { wrapper: Operator });
    await settle();
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/approach-d-conductor-engine/),
      "a-unit"
    );
    await user.click(screen.getByRole("button", { name: /look up/i }));
    await settle();
    expect(
      within(document.body)
        .getByRole("button", { name: /show raw data/i })
        .getAttribute("data-ui-bridge-id")
    ).toBe("digital-twin-delivery-show-raw");
    expect(polled).toEqual([]);
  });
});
