import { describe, expect, it } from "vitest";
import { describeFailure } from "./LoadFailure";

describe("describeFailure", () => {
  it("never shows a reader the raw status line", () => {
    const raw =
      'GET /api/v1/operations/plans failed: 502 - {"error":"BAD_GATEWAY","message":"coord is not reachable"}';
    const text = describeFailure(raw);
    expect(text).not.toMatch(/502|BAD_GATEWAY|\/api\//);
    expect(text).toMatch(/isn't responding/);
  });

  it("tells expired sessions and missing access apart", () => {
    expect(describeFailure("GET /x failed: 401 - {}")).toMatch(/Sign in again/);
    expect(describeFailure("GET /x failed: 403 - {}")).toMatch(/access/);
  });

  it("falls back to a generic sentence for anything else", () => {
    expect(describeFailure("Network Error")).toMatch(/Something went wrong/);
  });
});
