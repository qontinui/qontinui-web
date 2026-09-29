/**
 * GroupList against a mocked transport: the empty state names the project,
 * the runner hint's present/absent arms, and the registry-veto 409 (plan
 * `2026-09-17-regression-tests-target-the-selected-project` Phase 2). The hooks
 * and helpers are REAL; only `httpClient`, the toaster and the tenant context
 * are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: "t-shop", slug: "shop", name: "Pizza Shop" }],
    activeTenantId: "t-shop",
    isMultiTenant: false,
    loading: false,
    error: null,
    setActiveTenantId: () => {},
    refresh: async () => true,
  }),
}));

import { GroupList } from "./GroupList";

const GROUP = {
  group_id: "g1",
  name: "Menu",
  target_url: "https://example.com",
  enabled: true,
  condition_count: 1,
  last_status: null,
};
const DEV = "aaaaaaaa-0000-0000-0000-000000000001";

type Answer = unknown | Error;
function route(answers: { groups: Answer; health: Answer; drain?: Answer }) {
  get.mockImplementation(async (url: string) => {
    const pick = url.endsWith("/conditions/groups")
      ? answers.groups
      : url.endsWith("/fleet/health")
        ? answers.health
        : url.endsWith("/fleet/drain")
          ? (answers.drain ?? { drains: {} })
          : new Error(`unexpected GET ${url}`);
    if (pick instanceof Error) throw pick;
    return pick;
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  toastError.mockReset();
});

describe("GroupList empty state", () => {
  it("names the project and says groups belong to one project", async () => {
    route({ groups: [], health: new Error("GET x failed: 403 - no") });
    render(<GroupList />);
    const empty = await screen.findByTestId("conditions-empty");
    expect(empty.textContent).toContain("No condition groups in Pizza Shop");
    expect(
      screen.getByText(/Each group belongs to one project/).textContent
    ).toContain("appear when you switch to it");
  });
});

describe("GroupList runner hint", () => {
  it("shows no hint when an online device can take the run", async () => {
    route({
      groups: [GROUP],
      health: { devices: [{ device_id: DEV, within_dispatch_window: true }] },
    });
    render(<GroupList />);
    await screen.findByText("Menu");
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        "/api/v1/operations/fleet/drain",
        expect.anything()
      )
    );
    expect(screen.queryByTestId("conditions-runner-hint")).toBeNull();
  });

  it("shows the hint by Run when no device is online, and Run stays enabled", async () => {
    route({
      groups: [GROUP],
      health: { devices: [{ device_id: DEV, within_dispatch_window: false }] },
    });
    render(<GroupList />);
    const hint = await screen.findByTestId("conditions-runner-hint");
    expect(hint.textContent).toContain("No runner paired to “Pizza Shop”");
    const run = screen.getByTestId("run-group");
    expect(run.hasAttribute("disabled")).toBe(false);
    expect(run.getAttribute("aria-describedby")).toBe("conditions-runner-hint");
  });

  it("shows no hint when the roster read fails (unknown is not 'no runners')", async () => {
    route({
      groups: [GROUP],
      health: new Error(
        "GET /api/v1/operations/fleet/health failed: 403 - forbidden"
      ),
    });
    render(<GroupList />);
    await screen.findByText("Menu");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId("conditions-runner-hint")).toBeNull();
  });
});

describe("GroupList manual run veto", () => {
  it("renders the registry veto's message on a 409, not a generic failure", async () => {
    route({ groups: [GROUP], health: { devices: [] } });
    const coord = {
      error: "spawn_vetoed",
      agent_name: "condition_autodispatch",
      disposition: "block",
      hint: "condition checks are disabled in this tenant's agent registry",
    };
    post.mockRejectedValue(
      new Error(
        "POST /api/v1/conditions/groups/g1/run failed: 409 - " +
          JSON.stringify({ error: "conflict", message: JSON.stringify(coord) })
      )
    );
    render(<GroupList />);
    await userEvent.click(await screen.findByTestId("run-group"));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const text = String(toastError.mock.calls[0]?.[0]);
    expect(text).toContain("turned off for this project");
    expect(text).toContain(coord.hint);
    expect(text).not.toContain("Failed to start run");
  });
});
