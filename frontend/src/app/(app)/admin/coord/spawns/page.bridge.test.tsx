/**
 * The switches' UI Bridge `set` actions on `/admin/coord/spawns`, over the real
 * hooks and the real client. An automated caller cannot see the matrix, so what
 * the action settles with is all it knows: it resolves only when coord read back
 * what was asked, and rejects naming the outcome when coord refused the write,
 * read back something else, or no read says.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

interface RegisteredElement {
  customActions?: {
    set?: {
      effect: string;
      description: string;
      handler: (p: unknown) => Promise<unknown>;
    };
  };
}
const registered = new Map<string, RegisteredElement>();

vi.mock("@qontinui/ui-bridge/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@qontinui/ui-bridge/react")>()),
  useUIElement: (config: RegisteredElement & { id: string }) => {
    registered.set(config.id, config);
    return { ref: () => {} };
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/spawns",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

let routes: SpawnsRoutes = defaultSpawnsRoutes();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) =>
      answerSpawnsRequest(routes, url, init),
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  type SpawnsRoutes,
} from "./__fixtures__/spawnsRoutes";
import { defaultsBody, mergeSettingsBody } from "./__fixtures__/spawnPaths";
import CoordSpawnsPage from "./page";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderAndOpen(pathKey: string) {
  render(<CoordSpawnsPage />);
  await settle();
  const row = screen
    .getAllByTestId("coord-spawns-path-row")
    .find((r) => r.getAttribute("data-path") === pathKey)!;
  await act(async () => {
    fireEvent.click(within(row).getByTestId("coord-spawns-path-toggle"));
  });
  await settle();
}

/** Run a control's `set` action to its end, whichever way it settles. */
async function runSet(id: string, value: string) {
  const action = registered.get(id)?.customActions?.set;
  if (!action) throw new Error(`no set action on ${id}`);
  expect(action.effect).toBe("write");
  let settled: { resolved?: unknown; rejected?: Error } = {};
  await act(async () => {
    settled = await action.handler({ value }).then(
      (resolved) => ({ resolved }),
      (rejected: Error) => ({ rejected })
    );
  });
  return settled;
}

const SHEPHERD = "coord-spawns-path-switch-merge_shepherd";

beforeEach(() => {
  registered.clear();
  routes = defaultSpawnsRoutes();
});

describe("the switches' UI Bridge action settles with coord's answer", () => {
  it("resolves with the read-back when coord reads back what was asked", async () => {
    await renderAndOpen("merge_shepherd");
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    expect(await runSet(SHEPHERD, "off")).toEqual({
      resolved: {
        outcome: "read_back",
        asked: "off",
        readBack: "off",
        message: null,
      },
    });
  });

  it("rejects on a 403, naming the refusal", async () => {
    await renderAndOpen("merge_shepherd");
    routes.putRegistry = () => ({
      status: 403,
      body: { detail: "not_coord_tenant_admin" },
    });
    const { resolved, rejected } = await runSet(SHEPHERD, "off");
    expect(resolved).toBeUndefined();
    expect(rejected?.message).toMatch(/^refused: /);
    expect(rejected?.message).toContain(
      "only a coord tenant admin of the active project may change it"
    );
  });

  it("rejects when coord reads back something else", async () => {
    await renderAndOpen("merge_shepherd");
    const { rejected } = await runSet(SHEPHERD, "off");
    expect(rejected?.message).toBe(
      "contradicted: asked for off; coord reads back on"
    );
  });

  it("rejects as unknown when the read-back failed", async () => {
    await renderAndOpen("merge_shepherd");
    routes.defaults = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    const { rejected } = await runSet(SHEPHERD, "off");
    expect(rejected?.message).toMatch(/^unknown: reading back/);
  });

  it("rejects as unknown when a timed-out write's re-read failed too", async () => {
    await renderAndOpen("red_main_fix_dispatch");
    routes.putNextStep = () => ({
      status: 504,
      body: { detail: "timeout waiting for coord" },
    });
    routes.nextStep = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    const { rejected } = await runSet(
      "coord-spawns-path-autonomy-red_main_fix",
      "guidance_only"
    );
    expect(rejected?.message).toMatch(/^unknown: /);
  });

  it("settles a dial write coord refused, and one it read back, by the same rule", async () => {
    await renderAndOpen("pr_fix_dispatch");
    routes.patchMerge = () => ({
      status: 403,
      body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
    });
    const refused = await runSet("coord-spawns-path-fixer-dial", "off");
    expect(refused.rejected?.message).toMatch(/^refused: /);
    routes.patchMerge = () => ({
      body: mergeSettingsBody({
        tenant: false,
        resolved: false,
        source: "tenant",
      }),
    });
    const saved = await runSet("coord-spawns-path-fixer-dial", "off");
    expect(saved.resolved).toMatchObject({
      outcome: "read_back",
      readBack: "off",
    });
  });

  it("describes to an automated caller what the action re-reads and when it rejects", async () => {
    await renderAndOpen("merge_shepherd");
    const registry = registered.get(SHEPHERD)?.customActions?.set?.description;
    expect(registry).toContain("then re-reads the tenant defaults");
    expect(registry).not.toContain("effective row");
    expect(registry).toContain("rejects unless coord read back what was asked");
    await renderAndOpen("red_main_fix_dispatch");
    for (const id of [
      "coord-spawns-path-red-main-knob",
      "coord-spawns-path-autonomy-red_main_fix",
    ]) {
      expect(registered.get(id)?.customActions?.set?.description).toContain(
        "rejects unless coord read back what was asked"
      );
    }
    await renderAndOpen("pr_fix_dispatch");
    expect(
      registered.get("coord-spawns-path-fixer-dial")?.customActions?.set
        ?.description
    ).toContain("rejects unless coord read back what was asked");
  });

  it("says what a value outside the switch's own is, sending nothing", async () => {
    await renderAndOpen("merge_shepherd");
    let puts = 0;
    routes.putRegistry = () => {
      puts += 1;
      return { body: {} };
    };
    const { rejected } = await runSet(SHEPHERD, "maybe");
    expect(rejected?.message).toContain("value must be one of");
    expect(puts).toBe(0);
  });
});
