import { describe, expect, it } from "vitest";
import { deviceApiErrorMessage } from "./device-error";

const FALLBACK = "Failed to deregister runner";

describe("deviceApiErrorMessage", () => {
  it("reads a string detail", () => {
    expect(
      deviceApiErrorMessage({ detail: "Device not found" }, FALLBACK)
    ).toBe("Device not found");
  });

  it("reads the message of a structured detail (409 device_is_ci_runner)", () => {
    const body = {
      detail: {
        error: "device_is_ci_runner",
        code: "device_is_ci_runner",
        message: "This device id is a CI runner row; nothing was deleted.",
      },
    };
    expect(deviceApiErrorMessage(body, FALLBACK)).toBe(
      "This device id is a CI runner row; nothing was deleted."
    );
  });

  it("reads the body the served error handler sends for the 409", () => {
    // error_handler.http_exception_handler flattens the structured detail.
    const body = {
      error: "device_is_ci_runner",
      code: "device_is_ci_runner",
      message: "This device id is a CI runner row; nothing was deleted.",
      timestamp: "2026-11-18T00:00:00Z",
      path: "/api/v1/devices/x",
    };
    expect(deviceApiErrorMessage(body, FALLBACK)).toBe(
      "This device id is a CI runner row; nothing was deleted."
    );
  });

  it("falls back to a top-level code only when there is no message", () => {
    expect(
      deviceApiErrorMessage({ code: "device_is_ci_runner" }, FALLBACK)
    ).toBe("device_is_ci_runner");
  });

  it("does not read a 422 detail array as a message", () => {
    expect(
      deviceApiErrorMessage(
        { detail: [{ msg: "bad" }], message: "Invalid request data" },
        FALLBACK
      )
    ).toBe("Invalid request data");
  });

  it("never renders an object as [object Object]", () => {
    expect(deviceApiErrorMessage({ detail: { other: 1 } }, FALLBACK)).toBe(
      FALLBACK
    );
  });

  it("reads a top-level message, then the fallback", () => {
    expect(deviceApiErrorMessage({ message: "boom" }, FALLBACK)).toBe("boom");
    expect(deviceApiErrorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(deviceApiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });
});
