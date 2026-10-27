/**
 * /settings/fleet — the app config read and write are for platform admins
 * only (coord finding `b27adf71`; backend `require_admin` on `GET /fleet/apps`
 * and `PATCH /fleet/apps/{app_id}`).
 *
 * This page is in every user's settings menu, so a viewer who is not a
 * platform admin meets the refusal here first. It must read as what it is: a
 * labelled "limited to platform administrators" state in place of the
 * registry, no editor and no add-designation form built from an empty app
 * list — never "No apps registered yet" and never a "Failed to load" toast.
 * The designations of the viewer's own devices stay listed.
 *
 * `httpClient.fetch` is mocked at the service boundary with real `Response`s,
 * so `lib/api/fleet.ts`'s own error handling (`FleetApiError`) runs as in
 * production; the 403 body is the production envelope `require_admin` sends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import FleetSettingsPage from "./page";

const ADMIN_ONLY = "App configuration is limited to platform administrators.";
const DEVICE = "66666666-6666-6666-6666-666666666666";
const APP = "qontinui-web";

const ADMIN_REFUSAL = {
  error: "FORBIDDEN",
  message: "Not authorized. Admin access required.",
  timestamp: 1790000000,
  path: "https://api.test/api/v1/fleet/apps",
};

const PULL_BUILD_APP = {
  app_id: APP,
  display_name: "Qontinui Web",
  repo_root: "/code/qontinui-web",
  update_strategy: "pull_build",
  build_command: "npm run build",
  start_command: "npm start",
};

const DESIGNATION = {
  device_id: DEVICE,
  app_id: APP,
  auto_fresh: true,
  device_name: "build-box",
  hostname: "build-box.local",
  derived_status: "healthy",
  freshness: null,
  deployed_sha: null,
  deployed_at: null,
  created_at: "2026-10-27T12:00:00Z",
  updated_at: "2026-10-27T12:00:00Z",
};

/** The app-config editors; a viewer who is not an admin gets none of them. */
const EDITORS = [
  "fleet-app-strategy",
  "fleet-app-save",
  "fleet-app-build-command",
  "fleet-app-start-command",
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Serve the page's four reads; `apps` decides the registry's answer. */
function serve(apps: () => Response) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/fleet/apps") && !init?.method) return apps();
    if (url.endsWith("/fleet/test-targets")) return json(200, [DESIGNATION]);
    if (url.endsWith("/fleet/freshness")) return json(200, []);
    if (url.endsWith("/devices")) return json(200, []);
    throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
  });
}

beforeEach(() => {
  serve(() => json(200, [PULL_BUILD_APP]));
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  toastError.mockReset();
});

describe("/settings/fleet app config admin gate", () => {
  it("renders a non-admin's 403 as the labelled state, with no editor and no add form", async () => {
    serve(() => json(403, ADMIN_REFUSAL));
    render(<FleetSettingsPage />);

    const state = await screen.findByTestId("fleet-apps-admin-only");
    expect(state).toHaveTextContent(ADMIN_ONLY);
    for (const testId of EDITORS) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    // Not an empty registry, and not a load failure.
    expect(screen.queryByText(/No apps registered yet/)).toBeNull();
    expect(screen.queryByTestId("fleet-apps-read-failed")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    // The add form's App choice would be the (unreadable) registry: replaced
    // by a sentence, so no empty App list is offered.
    expect(
      screen.getByTestId("fleet-designate-needs-registry")
    ).toHaveTextContent(/only a platform administrator can read/);
    expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
    // The viewer's own designations are still listed.
    expect(screen.getByText("build-box")).toBeInTheDocument();
  });

  it("renders an admin's registry with its editors (the control for the test above)", async () => {
    render(<FleetSettingsPage />);

    for (const testId of EDITORS) {
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("fleet-apps-admin-only")).toBeNull();
    expect(screen.queryByTestId("fleet-designate-needs-registry")).toBeNull();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeInTheDocument();
  });

  it.each([
    [
      "a proxy's HTML page",
      () =>
        new Response("<html>Forbidden</html>", {
          status: 403,
          headers: { "Content-Type": "text/html" },
        }),
    ],
    ["another JSON refusal", () => json(403, { message: "Forbidden" })],
  ])(
    "keeps a 403 that is not the admin refusal (%s) a load failure",
    async (_shape, apps) => {
      serve(apps);
      render(<FleetSettingsPage />);

      expect(
        await screen.findByTestId("fleet-apps-read-failed")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("fleet-apps-admin-only")).toBeNull();
      expect(screen.queryByText(/No apps registered yet/)).toBeNull();
      await waitFor(() => expect(toastError).toHaveBeenCalled());
    }
  );

  it("keeps the loader up while the registry read is out, though another read already failed", async () => {
    let answerRegistry!: (response: Response) => void;
    const registry = new Promise<Response>((resolve) => {
      answerRegistry = resolve;
    });
    let devicesFailed = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fleet/apps") && !init?.method) return registry;
      if (url.endsWith("/fleet/test-targets")) return json(200, [DESIGNATION]);
      if (url.endsWith("/fleet/freshness")) return json(200, []);
      if (url.endsWith("/devices")) {
        devicesFailed = true;
        return json(500, { detail: "coord unavailable" });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
    render(<FleetSettingsPage />);

    // `/devices` (the coord-backed read) has failed and its rejection has had
    // every tick it needs; `/fleet/apps` is still out.
    await waitFor(() => expect(devicesFailed).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    // Nothing may say what the unread registry holds.
    expect(screen.getByTestId("fleet-loading")).toBeInTheDocument();
    expect(screen.queryByText(/No apps registered yet/)).toBeNull();
    expect(screen.queryByTestId("fleet-designate-needs-registry")).toBeNull();
    expect(screen.queryByTestId("fleet-apps-read-failed")).toBeNull();

    // The registry answers: this viewer is not a platform admin.
    answerRegistry(json(403, ADMIN_REFUSAL));
    expect(await screen.findByTestId("fleet-apps-admin-only")).toBeVisible();
    expect(screen.queryByText(/No apps registered yet/)).toBeNull();
    expect(screen.queryByTestId("fleet-loading")).toBeNull();
    // The failed read is still reported, and the refusal is not.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Failed to load fleet data: coord unavailable"
    );
  });

  it("names every read that failed, not only the first", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fleet/apps") && !init?.method) {
        return json(200, [PULL_BUILD_APP]);
      }
      if (url.endsWith("/fleet/test-targets")) {
        return json(502, { detail: "test targets unavailable" });
      }
      if (url.endsWith("/fleet/freshness")) return json(200, []);
      if (url.endsWith("/devices")) {
        return json(500, { detail: "coord unavailable" });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
    render(<FleetSettingsPage />);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "Failed to load fleet data: test targets unavailable; coord unavailable"
    );
  });

  it("labels a refused save and takes the editors away", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/fleet/apps/${APP}`) && init?.method === "PATCH") {
        return json(403, { ...ADMIN_REFUSAL, path: url });
      }
      if (url.endsWith("/fleet/apps")) return json(200, [PULL_BUILD_APP]);
      if (url.endsWith("/fleet/test-targets")) return json(200, [DESIGNATION]);
      if (url.endsWith("/fleet/freshness")) return json(200, []);
      if (url.endsWith("/devices")) return json(200, []);
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
    render(<FleetSettingsPage />);

    fireEvent.change(await screen.findByTestId("fleet-app-build-command"), {
      target: { value: "make" },
    });
    fireEvent.click(screen.getByTestId("fleet-app-save"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(`Failed to save: ${ADMIN_ONLY}`)
    );
    expect(await screen.findByTestId("fleet-apps-admin-only")).toBeVisible();
    for (const testId of EDITORS) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });
});
