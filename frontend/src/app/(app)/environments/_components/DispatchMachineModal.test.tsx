import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
const getRunnersMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: vi.fn(),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
  runnerService: {
    getRunners: (...args: unknown[]) => getRunnersMock(...args),
  },
}));

// `vi.hoisted` because the sonner factory dereferences the object EAGERLY
// (`toast: toastMock`), unlike the httpClient factory above whose arrow
// function defers until call time.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { DispatchMachineModal } from "./DispatchMachineModal";

/**
 * The dispatch modal is the ONLY caller of `POST /devenv/machines/dispatch-enroll`,
 * which means it is the only thing standing between that route's typed refusals
 * and the operator.
 *
 * That matters more than it looks. The route was changed to answer a typed
 * **409 `device_already_has_machine`** instead of an untyped 500, on the
 * argument that a caller can act on a 409 and cannot act on a 500 — and the
 * modal was discarding the error entirely (`catch { toast.error("Dispatch
 * failed") }`), reproducing the exact unactionable failure the 409 replaced.
 * With connect-time auto-enrollment on, that 409 is the NORMAL result of
 * picking a box the engine already enrolled, because the picker still lists it.
 *
 * So these tests assert the SERVER's sentence reaches the toast. A regression
 * here is invisible in every other gate: types check, lint passes, the route
 * keeps returning the right thing, and the operator still sees nothing useful.
 */

const RUNNER = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "dev-box",
  hostname: "dev-box.local",
  wsConnected: true,
  derivedStatus: "healthy",
};

function errorResponse(
  status: number,
  detail: { code: string; message: string }
): Response {
  return {
    ok: false,
    status,
    json: async () => ({ detail }),
  } as Response;
}

async function submitDispatch() {
  render(
    <DispatchMachineModal
      open
      environments={[]}
      onClose={vi.fn()}
      onDispatched={vi.fn()}
      onFallback={vi.fn()}
    />
  );

  // Wait for the device picker to populate, then pick the box and name it.
  await waitFor(() => expect(screen.getByText("dev-box")).toBeInTheDocument());
  fireEvent.click(screen.getByText("dev-box"));

  const nameInput = screen.getByRole("textbox");
  fireEvent.change(nameInput, { target: { value: "my-box" } });

  const submit = screen
    .getAllByRole("button")
    .find((b) => /enroll|dispatch/i.test(b.textContent ?? ""));
  expect(submit).toBeDefined();
  fireEvent.click(submit!);
}

describe("DispatchMachineModal error surfacing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getRunnersMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    getRunnersMock.mockResolvedValue([RUNNER]);
  });

  it("shows the server's sentence for a 409, not a bare 'Dispatch failed'", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(409, {
        code: "device_already_has_machine",
        message:
          "This device already has an active machine. Revoke or delete it before binding another machine to the same device.",
      })
    );

    await submitDispatch();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    const shown = String(toastMock.error.mock.calls[0][0]);
    // The remedy is the whole point of the typed code — it must survive.
    expect(shown).toMatch(/Revoke or delete it/);
    expect(shown).not.toBe("Dispatch failed");
  });

  it("shows the server's sentence for the 404 owner gate too", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(404, {
        code: "device_not_found",
        message: "device not found.",
      })
    );

    await submitDispatch();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(String(toastMock.error.mock.calls[0][0])).toMatch(/device not found/i);
  });

  it("still falls back to the generic message when there is no server sentence", async () => {
    // A transport failure has no envelope to read. The fallback is correct
    // here, and keeping it proves the tests above are about the SERVER's words
    // rather than about the string having changed.
    fetchMock.mockRejectedValue(new Error("network down"));

    await submitDispatch();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(String(toastMock.error.mock.calls[0][0])).toBe("network down");
  });
});
