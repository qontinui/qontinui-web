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
 * The designations of the viewer's own devices stay listed, and the copy
 * around them promises only what is on screen: no "Add one above." without an
 * add form, no "designations below" when there are none.
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
import {
  ADMIN_REFUSAL,
  APP_ID as APP,
  DESIGNATION,
  PULL_BUILD_APP,
  fleetResponder,
  json,
  type FleetReads,
} from "./__fixtures__/fleetSettings";

const ADMIN_ONLY = "App configuration is limited to platform administrators.";

/** The app-config editors; a viewer who is not an admin gets none of them. */
const EDITORS = [
  "fleet-app-strategy",
  "fleet-app-save",
  "fleet-app-build-command",
  "fleet-app-start-command",
];

/** Serve the page's four reads; `reads` overrides their good defaults. */
function serve(reads: FleetReads = {}) {
  fetchMock.mockImplementation(fleetResponder(reads));
}

const REFUSED = { apps: () => json(403, ADMIN_REFUSAL) };

beforeEach(() => {
  serve();
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  toastError.mockReset();
});

describe("/settings/fleet app config admin gate", () => {
  it("renders a non-admin's 403 as the labelled state, with no editor and no add form", async () => {
    serve(REFUSED);
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
    // by a sentence, so no empty App list is offered. There IS a designation
    // below, so the sentence may say it can still be changed.
    expect(
      screen.getByTestId("fleet-designate-needs-registry").textContent
    ).toBe(
      "Adding a designation needs the app registry, which only a platform administrator can read. The designations below can still be changed."
    );
    expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
    // The viewer's own designations are still listed.
    expect(screen.getByText("build-box")).toBeInTheDocument();
  });

  it("promises a non-admin with no designations neither an add form nor designations to change", async () => {
    serve({ ...REFUSED, targets: () => json(200, []) });
    render(<FleetSettingsPage />);

    await screen.findByTestId("fleet-apps-admin-only");
    // No "The designations below can still be changed.": there are none.
    expect(
      screen.getByTestId("fleet-designate-needs-registry").textContent
    ).toBe(
      "Adding a designation needs the app registry, which only a platform administrator can read."
    );
    // No "Add one above.": there is no add form above.
    expect(screen.getByTestId("fleet-targets-empty").textContent).toBe(
      "No test hosts designated yet."
    );
    expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
  });

  it("points an admin with no designations at the add form (the control for the test above)", async () => {
    serve({ targets: () => json(200, []) });
    render(<FleetSettingsPage />);

    expect((await screen.findByTestId("fleet-targets-empty")).textContent).toBe(
      "No test hosts designated yet. Add one above."
    );
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeInTheDocument();
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
      serve({ apps });
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
