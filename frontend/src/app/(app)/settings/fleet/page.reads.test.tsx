/**
 * /settings/fleet: a read that failed renders UNKNOWN or STALE, never "none".
 *
 * Served policy `verification-and-evidence`
 * `unknown-must-not-render-as-a-default`. A failed `/fleet/test-targets` or
 * `/fleet/freshness` read used to leave its section at `[]`. The page then
 * said "No test hosts designated yet. Add one above." and "No deployment state
 * reported yet", next to a toast naming the failure. Now each read keeps its
 * own outcome (`useFleetRead`). A read that never delivered and then failed is
 * UNKNOWN, in place of the section. Rows an earlier read delivered, which a
 * newer read failed to replace, are STALE: the rows stay, with a label above
 * them. Both labels give the reason. The app registry and the device list
 * follow the same rule. A failed re-read after a designation write that
 * succeeded is no longer reported as the write failing.
 *
 * `httpClient.fetch` is mocked at the service boundary with real `Response`s,
 * so `lib/api/fleet.ts`'s own error handling runs as in production.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import FleetSettingsPage from "./page";
import {
  DESIGNATION,
  DEVICE,
  FRESHNESS_ROW,
  PULL_BUILD_APP,
  fleetResponder,
  json,
  type FleetReads,
} from "./__fixtures__/fleetSettings";

function serve(reads: FleetReads = {}) {
  fetchMock.mockImplementation(fleetResponder(reads));
}

/** A read the backend fails, with `reason` as the body's `detail`. */
function down(reason: string) {
  return () => json(502, { detail: reason });
}

/** Answers `good` on the first call and fails every later one. */
function goodOnceThenDown(good: () => Response, reason: string) {
  let calls = 0;
  return () => (calls++ === 0 ? good() : json(502, { detail: reason }));
}

/** The short sha the freshness row shows: the row is on screen. */
const FRESHNESS_ROW_SHA = FRESHNESS_ROW.deployed_sha.slice(0, 9);

const UNKNOWN_NOTES = [
  "fleet-apps-read-failed",
  "fleet-targets-read-unknown",
  "fleet-freshness-read-unknown",
  "fleet-devices-read-unknown",
];
const STALE_NOTES = [
  "fleet-apps-read-stale",
  "fleet-targets-read-stale",
  "fleet-freshness-read-stale",
  "fleet-devices-read-stale",
];

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.useRealTimers();
});

describe("/settings/fleet: a failed read is UNKNOWN, never none", () => {
  it("renders a failed designations read as unknown, with its reason", async () => {
    serve({ targets: down("test targets unavailable") });
    render(<FleetSettingsPage />);

    const note = await screen.findByTestId("fleet-targets-read-unknown");
    expect(note).toHaveTextContent("whether any exist is unknown");
    expect(note).toHaveTextContent("Reason: test targets unavailable");
    expect(screen.queryByText(/No test hosts designated yet/)).toBeNull();
    expect(screen.queryByTestId("fleet-targets-read-stale")).toBeNull();
  });

  it("renders a failed freshness read as unknown, with its reason", async () => {
    serve({ freshness: down("freshness unavailable") });
    render(<FleetSettingsPage />);

    const note = await screen.findByTestId("fleet-freshness-read-unknown");
    expect(note).toHaveTextContent("whether any is reported is unknown");
    expect(note).toHaveTextContent("Reason: freshness unavailable");
    expect(screen.queryByText(/No deployment state reported yet/)).toBeNull();
    expect(screen.queryByTestId("fleet-freshness-read-stale")).toBeNull();
  });

  it("names why the app registry could not be read", async () => {
    serve({ apps: () => json(500, { detail: "registry down" }) });
    render(<FleetSettingsPage />);

    const note = await screen.findByTestId("fleet-apps-read-failed");
    expect(note).toHaveTextContent("which apps are registered is unknown");
    expect(note).toHaveTextContent("Reason: registry down");
    expect(screen.queryByText(/No apps registered yet/)).toBeNull();
  });

  it("offers no add form when the device list could not be read, and says why", async () => {
    serve({
      devices: () => json(500, { detail: "coord unavailable" }),
      targets: () => json(200, []),
    });
    render(<FleetSettingsPage />);

    const note = await screen.findByTestId("fleet-devices-read-unknown");
    expect(note).toHaveTextContent("Reason: coord unavailable");
    // An empty Device choice would read as "you have no devices".
    expect(screen.queryByTestId("fleet-designate-device")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
    // And nothing points at the form that is not there.
    expect(screen.getByTestId("fleet-targets-empty").textContent).toBe(
      "No test hosts designated yet."
    );
  });

  it("shows no unknown or stale label when every read answers (the control)", async () => {
    serve({
      freshness: () => json(200, [FRESHNESS_ROW]),
      devices: () => json(200, [DEVICE]),
    });
    render(<FleetSettingsPage />);

    await screen.findByTestId("fleet-app-save");
    for (const testId of [...UNKNOWN_NOTES, ...STALE_NOTES]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    expect(screen.getByText(FRESHNESS_ROW_SHA)).toBeInTheDocument();
  });
});

describe("/settings/fleet: rows a newer read failed to replace are STALE", () => {
  it("keeps every section's rows after a failed refresh, labelled with the reason", async () => {
    let failing = false;
    const unlessFailing = (good: () => Response, reason: string) => () =>
      failing ? json(502, { detail: reason }) : good();
    serve({
      apps: unlessFailing(() => json(200, [PULL_BUILD_APP]), "registry down"),
      targets: unlessFailing(() => json(200, [DESIGNATION]), "targets down"),
      freshness: unlessFailing(
        () => json(200, [FRESHNESS_ROW]),
        "freshness down"
      ),
      devices: unlessFailing(() => json(200, [DEVICE]), "devices down"),
    });
    render(<FleetSettingsPage />);
    await screen.findByTestId("fleet-app-save");

    failing = true;
    fireEvent.click(screen.getByTestId("fleet-refresh"));

    expect(
      await screen.findByTestId("fleet-apps-read-stale")
    ).toHaveTextContent("Reason: registry down");
    expect(screen.getByTestId("fleet-targets-read-stale")).toHaveTextContent(
      "Reason: targets down"
    );
    expect(screen.getByTestId("fleet-freshness-read-stale")).toHaveTextContent(
      "Reason: freshness down"
    );
    expect(screen.getByTestId("fleet-devices-read-stale")).toHaveTextContent(
      "Reason: devices down"
    );
    // The rows stay: they are real, only old. Nothing is called unknown.
    expect(screen.getByTestId("fleet-app-save")).toBeInTheDocument();
    expect(screen.getByTestId("fleet-target-remove")).toBeInTheDocument();
    expect(screen.getByText(FRESHNESS_ROW_SHA)).toBeInTheDocument();
    expect(screen.getByTestId("fleet-designate-device")).toBeInTheDocument();
    for (const testId of UNKNOWN_NOTES) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }

    // A refresh that answers clears every label.
    failing = false;
    fireEvent.click(screen.getByTestId("fleet-refresh"));
    await screen.findByTestId("fleet-app-save");
    for (const testId of STALE_NOTES) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });

  it("labels the freshness rows stale when a poll fails, silently, and clears it when one answers", async () => {
    // Only the poll's interval is faked; testing-library's own polling runs
    // on the real setTimeout.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let pollFails = false;
    serve({
      freshness: () =>
        pollFails
          ? json(502, { detail: "freshness poll failed" })
          : json(200, [FRESHNESS_ROW]),
    });
    render(<FleetSettingsPage />);
    await screen.findByTestId("fleet-app-save");
    expect(screen.queryByTestId("fleet-freshness-read-stale")).toBeNull();

    pollFails = true;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      await screen.findByTestId("fleet-freshness-read-stale")
    ).toHaveTextContent("Reason: freshness poll failed");
    expect(screen.getByText(FRESHNESS_ROW_SHA)).toBeInTheDocument();
    // The poll stays silent: the label says it, not a toast every 10 s.
    expect(toastError).not.toHaveBeenCalled();

    pollFails = false;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-freshness-read-stale")).toBeNull()
    );
  });
});

describe("/settings/fleet: a failed re-read is not a failed write", () => {
  it("does not report a toggle that succeeded as failed when only the re-read failed", async () => {
    serve({
      targets: goodOnceThenDown(() => json(200, [DESIGNATION]), "targets down"),
      write: (method, url) => {
        if (method === "PUT" && url.includes("/fleet/test-targets/")) {
          return json(200, { ...DESIGNATION, auto_fresh: false });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });
    render(<FleetSettingsPage />);

    fireEvent.click(await screen.findByTestId("fleet-target-auto-fresh"));

    expect(
      await screen.findByTestId("fleet-targets-read-stale")
    ).toHaveTextContent("Reason: targets down");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still reports a toggle the backend refused (the control for the test above)", async () => {
    serve({
      write: () =>
        json(409, {
          error: "device_not_bound_to_project",
          message: "Device 'build-box' is not bound to project \"Acme\".",
        }),
    });
    render(<FleetSettingsPage />);

    fireEvent.click(await screen.findByTestId("fleet-target-auto-fresh"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to toggle auto-fresh: Device 'build-box' is not bound to project \"Acme\"."
      )
    );
    expect(screen.queryByTestId("fleet-targets-read-stale")).toBeNull();
  });

  it("does not report a removal that succeeded as failed when only the re-read failed", async () => {
    serve({
      targets: goodOnceThenDown(() => json(200, [DESIGNATION]), "targets down"),
      write: (method, url) => {
        if (method === "DELETE" && url.includes("/fleet/test-targets/")) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });
    render(<FleetSettingsPage />);

    fireEvent.click(await screen.findByTestId("fleet-target-remove"));

    expect(
      await screen.findByTestId("fleet-targets-read-stale")
    ).toHaveTextContent("Reason: targets down");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Removed build-box as test host for qontinui-web"
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not report a designation that succeeded as failed when only the re-read failed", async () => {
    serve({
      targets: goodOnceThenDown(() => json(200, []), "targets down"),
      devices: () => json(200, [DEVICE]),
      write: (method, url) => {
        if (method === "PUT" && url.includes("/fleet/test-targets/")) {
          return json(200, DESIGNATION);
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });
    const user = userEvent.setup();
    render(<FleetSettingsPage />);

    await user.click(await screen.findByTestId("fleet-designate-device"));
    await user.click(await screen.findByRole("option", { name: /build-box/ }));
    await user.click(screen.getByTestId("fleet-designate-app"));
    await user.click(
      await screen.findByRole("option", { name: PULL_BUILD_APP.display_name })
    );
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(
      await screen.findByTestId("fleet-targets-read-stale")
    ).toHaveTextContent("Reason: targets down");
    expect(toastSuccess).toHaveBeenCalledWith("Test host designated");
    expect(toastError).not.toHaveBeenCalled();
  });
});
