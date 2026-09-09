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
    // prose. This pins the shipped defect, which was a BOOLEAN probe
    // (`/ failed: 404 /.test(message)`): true anywhere in the string, so this
    // 500 read as a 404 — and the caller hides its banner for not-found, so
    // the operator would never have seen the real status. Reading the FIRST
    // ` failed: NNN ` is what closes that; the anchor closes the separate case
    // below.
    expect(
      httpStatusOf(
        new Error(
          'GET /api/v1/operations/x failed: 500 - {"detail":"upstream GET /q failed: 404 - gone"}'
        )
      )
    ).toBe(500);
  });

  it("returns null for a wrapper error that merely embeds an httpClient one", () => {
    // What the ANCHOR buys, and the reason it is not decoration. A message
    // that is not itself an `httpClient` status rejection can still quote one
    // — a retry wrapper, a batched reader, an error re-thrown with context.
    // Read unanchored, that borrowed status is reported as this request's own,
    // and the caller renders "not found" for a request that never got a 404.
    expect(
      httpStatusOf(
        new Error("Failed to fetch: upstream GET /q failed: 404 - nope")
      )
    ).toBeNull();
  });

  it("returns null when there is no status to read", () => {
    expect(httpStatusOf(new Error("Failed to fetch"))).toBeNull();
    expect(httpStatusOf(new Error("The operation was aborted"))).toBeNull();
    expect(httpStatusOf("not an error at all")).toBeNull();
  });
});
