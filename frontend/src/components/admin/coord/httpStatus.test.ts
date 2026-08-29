import { describe, expect, it } from "vitest";
import { httpStatusOf } from "./httpStatus";

describe("httpStatusOf", () => {
  it("reads the status field of an httpClient rejection", () => {
    expect(
      httpStatusOf(new Error("GET /api/v1/operations/x failed: 404 - {}"))
    ).toBe(404);
    expect(
      httpStatusOf(new Error("POST /api/v1/operations/x failed: 500 - boom"))
    ).toBe(500);
  });

  it("ignores a status-shaped string in the response BODY", () => {
    // The tail of the message is `await response.text()` — upstream-controlled
    // prose. An unanchored probe would read this 500 as a 404, and a caller
    // that hides its banner for not-found would never show the operator the
    // real status.
    expect(
      httpStatusOf(
        new Error(
          'GET /api/v1/operations/x failed: 500 - {"detail":"upstream GET /q failed: 404 - gone"}'
        )
      )
    ).toBe(500);
  });

  it("returns null when there is no status to read", () => {
    expect(httpStatusOf(new Error("Failed to fetch"))).toBeNull();
    expect(httpStatusOf(new Error("The operation was aborted"))).toBeNull();
    expect(httpStatusOf("not an error at all")).toBeNull();
  });
});
