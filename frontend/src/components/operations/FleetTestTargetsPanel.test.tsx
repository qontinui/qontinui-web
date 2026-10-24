/**
 * FleetTestTargetsPanel — a refused designation write is toasted with the
 * backend's own message, not the URL and raw JSON.
 *
 * Plan `2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-bound-to`
 * Phase 2: the PUT/DELETE now carry the selected project, and the backend
 * refuses (409) a device that project is not bound to, or a removal whose row
 * lives in another project. The refusal text says which project and how to fix
 * it — that is only useful if the operator actually sees it.
 *
 * `httpClient` is mocked at the service boundary with the exact rejection
 * shape it throws (`<VERB> <url> failed: <status> - <body>`), and the body is
 * the production error envelope (`error` + `message` at the top level).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import { FleetTestTargetsPanel } from "./FleetTestTargetsPanel";
import { designationErrorText } from "./fleetTestTargets";

const DEVICE = "66666666-6666-6666-6666-666666666666";
const APP = "qontinui-web";
const URL = `/api/v1/fleet/test-targets/${DEVICE}/${APP}`;

const NOT_BOUND =
  "Device 'build-box' is not bound to project \"Acme\", the project this " +
  "designation targets, so its runner would never see it. Bind the device " +
  'to "Acme", or switch to a project the device is bound to, then designate ' +
  "it again.";
const OTHER_PROJECT =
  "The designation of device 'build-box' for app 'qontinui-web' is recorded " +
  'under project "Home", not the selected project "Acme", so it was not ' +
  'removed. Switch to project "Home" and remove it there.';

function rejection(verb: string, status: number, body: string): Error {
  return new Error(`${verb} ${URL} failed: ${status} - ${body}`);
}

function envelope(error: string, message: string): string {
  return JSON.stringify({
    error,
    message,
    timestamp: 1790000000,
    path: `https://api.test${URL}`,
  });
}

beforeEach(() => {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith("/fleet/apps")) {
      return [
        {
          app_id: APP,
          display_name: "Qontinui Web",
          repo_root: "/code/qontinui-web",
          update_strategy: "pull_only",
          build_command: null,
          start_command: null,
        },
      ];
    }
    if (url.endsWith("/fleet/test-targets")) {
      return [
        {
          device_id: DEVICE,
          app_id: APP,
          auto_fresh: false,
          device_name: "build-box",
          hostname: "build-box.local",
          derived_status: "online",
          freshness: null,
          deployed_sha: null,
          deployed_at: null,
          created_at: "2026-09-30T12:00:00Z",
          updated_at: "2026-09-30T12:00:00Z",
        },
      ];
    }
    if (url.endsWith("/devices")) {
      return [{ id: DEVICE, name: "build-box", hostname: "build-box.local" }];
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FleetTestTargetsPanel designation refusals", () => {
  it("toasts the not-bound-to-project message when the PUT is refused", async () => {
    put.mockRejectedValue(
      rejection("PUT", 409, envelope("device_not_bound_to_project", NOT_BOUND))
    );
    render(<FleetTestTargetsPanel />);

    fireEvent.click(await screen.findByTestId("fleet-target-auto-fresh"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        `Designation failed: ${NOT_BOUND}`
      )
    );
    expect(put).toHaveBeenCalledWith(URL, { auto_fresh: true });
  });

  it("toasts the other-project message when the DELETE removed nothing", async () => {
    del.mockRejectedValue(
      rejection(
        "DELETE",
        409,
        envelope("designation_in_other_project", OTHER_PROJECT)
      )
    );
    render(<FleetTestTargetsPanel />);

    fireEvent.click(await screen.findByTestId("fleet-target-remove"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(`Remove failed: ${OTHER_PROJECT}`)
    );
  });

  it("keeps the full error text for anything that is not a designation refusal", async () => {
    const err = rejection("PUT", 502, "<html>Bad Gateway</html>");
    put.mockRejectedValue(err);
    render(<FleetTestTargetsPanel />);

    fireEvent.click(await screen.findByTestId("fleet-target-auto-fresh"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        `Designation failed: ${err.message}`
      )
    );
  });
});

describe("designationErrorText", () => {
  it("reads the refusal nested under `detail` (no envelope handler)", () => {
    const body = JSON.stringify({
      detail: { error: "device_not_bound_to_project", message: NOT_BOUND },
    });
    expect(designationErrorText(rejection("PUT", 409, body))).toBe(NOT_BOUND);
  });

  it("shows the generic coord_failed message, not the raw JSON", () => {
    const message =
      "coord failed to change the designation (500). Retry; if it persists, check coord.";
    const err = rejection("PUT", 500, envelope("coord_failed", message));
    expect(designationErrorText(err)).toBe(message);
  });

  it("does not promote the message of an unlisted error code", () => {
    const err = rejection("PUT", 404, envelope("not_found", "anything"));
    expect(designationErrorText(err)).toBe(err.message);
  });

  it("passes a non-httpClient error through", () => {
    expect(designationErrorText(new TypeError("Failed to fetch"))).toBe(
      "Failed to fetch"
    );
  });
});
