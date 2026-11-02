/**
 * SecretsBrokerDevicePanel — the states that must not collapse into one
 * another: unknown is not "no device", an invalid id is never sent, and a
 * non-admin cannot write.
 *
 * The hook is mocked; its read/write honesty is covered in
 * `../_hooks/useSecretsBrokerDevice.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const useSecretsBrokerDeviceMock = vi.fn();
vi.mock("../_hooks/useSecretsBrokerDevice", () => ({
  useSecretsBrokerDevice: () => useSecretsBrokerDeviceMock(),
}));

import { SecretsBrokerDevicePanel } from "./SecretsBrokerDevicePanel";

const DEVICE = "5b0e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0f8c2b1e-4d3a-4b5c-9e6f-7a8b9c0d1e2f";

function hookState(
  device: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    device,
    loading: false,
    saving: false,
    error: null,
    readbackError: null,
    reload: vi.fn(),
    setBrokerDevice: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const DESIGNATED = {
  device_id: DEVICE,
  reported: true,
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SecretsBrokerDevicePanel", () => {
  it("shows the device coord accepts reports from", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(hookState(DESIGNATED));
    render(<SecretsBrokerDevicePanel />);

    expect(
      screen.getByTestId("secrets-broker-device-current").textContent
    ).toBe(DEVICE);
  });

  it("designates a valid id, normalised to lower case", () => {
    const state = hookState(DESIGNATED);
    useSecretsBrokerDeviceMock.mockReturnValue(state);
    render(<SecretsBrokerDevicePanel />);

    fireEvent.change(screen.getByTestId("secrets-broker-device-input"), {
      target: { value: ` ${OTHER.toUpperCase()} ` },
    });
    fireEvent.click(screen.getByTestId("secrets-broker-device-set"));
    expect(state.setBrokerDevice).toHaveBeenCalledWith(OTHER);
  });

  it("never sends an id that is not a UUID", () => {
    const state = hookState(DESIGNATED);
    useSecretsBrokerDeviceMock.mockReturnValue(state);
    render(<SecretsBrokerDevicePanel />);

    fireEvent.change(screen.getByTestId("secrets-broker-device-input"), {
      target: { value: "spaceship" },
    });
    const set = screen.getByTestId(
      "secrets-broker-device-set"
    ) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    fireEvent.click(set);
    expect(state.setBrokerDevice).not.toHaveBeenCalled();
    expect(screen.getByTestId("secrets-broker-device-invalid")).toBeTruthy();
  });

  it("does not re-designate the device already in force", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(hookState(DESIGNATED));
    render(<SecretsBrokerDevicePanel />);

    fireEvent.change(screen.getByTestId("secrets-broker-device-input"), {
      target: { value: DEVICE },
    });
    expect(
      (screen.getByTestId("secrets-broker-device-set") as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("clears the designation with null", () => {
    const state = hookState(DESIGNATED);
    useSecretsBrokerDeviceMock.mockReturnValue(state);
    render(<SecretsBrokerDevicePanel />);

    fireEvent.click(screen.getByTestId("secrets-broker-device-clear"));
    expect(state.setBrokerDevice).toHaveBeenCalledWith(null);
  });

  it("renders an unreported device as unknown, not as no device", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(
      hookState({ ...DESIGNATED, device_id: null, reported: false })
    );
    render(<SecretsBrokerDevicePanel />);

    expect(
      screen.getByTestId("secrets-broker-device-current").textContent
    ).toBe("unknown");
    expect(screen.getByTestId("secrets-broker-device-unreported")).toBeTruthy();
    expect(
      (screen.getByTestId("secrets-broker-device-clear") as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("renders an explicit null as no device", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(
      hookState({ ...DESIGNATED, device_id: null })
    );
    render(<SecretsBrokerDevicePanel />);

    expect(
      screen.getByTestId("secrets-broker-device-current").textContent
    ).toBe("no device");
  });

  it("disables the write for a non-admin and says why", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(
      hookState({ ...DESIGNATED, can_edit: false })
    );
    render(<SecretsBrokerDevicePanel />);

    expect(
      (screen.getByTestId("secrets-broker-device-input") as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("secrets-broker-device-clear") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByTestId("secrets-broker-device-readonly").textContent
    ).toMatch(/not an admin/);
  });

  it("separates a failed read from a known value", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(
      hookState(null, { error: "HTTP 502" })
    );
    render(<SecretsBrokerDevicePanel />);

    expect(
      screen.getByTestId("secrets-broker-device-readonly").textContent
    ).toMatch(/could not be read/);
    expect(
      screen.getByTestId("secrets-broker-device-error").textContent
    ).toMatch(/unknown/);
    expect(
      screen.getByTestId("secrets-broker-device-current").textContent
    ).toBe("unknown");
  });

  it("surfaces a missing read-back instead of the written device", () => {
    useSecretsBrokerDeviceMock.mockReturnValue(
      hookState(DESIGNATED, { readbackError: "read-back failed" })
    );
    render(<SecretsBrokerDevicePanel />);

    expect(
      screen.getByTestId("secrets-broker-device-readback-error")
    ).toBeTruthy();
  });
});
