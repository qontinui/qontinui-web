import { describe, expect, it } from "vitest";

import {
  CROSS_ORIGIN_REFUSED,
  describeRunnerOriginRefusal,
  parseRunnerOriginRefusal,
  parseRunnerOriginRefusalText,
  readRunnerOriginRefusal,
} from "./origin-refusal";

const planShape = {
  success: false,
  code: CROSS_ORIGIN_REFUSED,
  error: "cross-origin request refused",
  context: {
    origin: "http://localhost:3001",
    class: "trusted",
    method: "GET",
    route_pattern: "/sessions",
    env_var: "QONTINUI_RUNNER_ALLOWED_ORIGINS",
    settings_field: "api.allowed_origins",
  },
};

describe("parseRunnerOriginRefusal", () => {
  it("parses the plan's documented envelope", () => {
    expect(parseRunnerOriginRefusal(planShape)).toEqual({
      code: CROSS_ORIGIN_REFUSED,
      message: "cross-origin request refused",
      origin: "http://localhost:3001",
      originClass: "trusted",
      method: "GET",
      routePattern: "/sessions",
      envVar: "QONTINUI_RUNNER_ALLOWED_ORIGINS",
      settingsField: "api.allowed_origins",
    });
  });

  it("finds the code under error_detail and the context under data", () => {
    const r = parseRunnerOriginRefusal({
      success: false,
      error_detail: { code: CROSS_ORIGIN_REFUSED },
      data: { origin: "http://localhost:3001", route_pattern: "/x" },
    });
    expect(r?.routePattern).toBe("/x");
    expect(r?.envVar).toBe("QONTINUI_RUNNER_ALLOWED_ORIGINS");
    expect(r?.settingsField).toBe("api.allowed_origins");
  });

  it("rejects everything that is not exactly CROSS_ORIGIN_REFUSED", () => {
    expect(parseRunnerOriginRefusal(null)).toBeNull();
    expect(parseRunnerOriginRefusal("CROSS_ORIGIN_REFUSED")).toBeNull();
    expect(parseRunnerOriginRefusal({ code: "HOST_NOT_LOOPBACK" })).toBeNull();
    expect(parseRunnerOriginRefusal({ success: true, data: {} })).toBeNull();
    expect(parseRunnerOriginRefusalText("<html>403</html>")).toBeNull();
    expect(parseRunnerOriginRefusalText("")).toBeNull();
  });
});

describe("readRunnerOriginRefusal", () => {
  it("reads a 403 without consuming the response", async () => {
    const resp = new Response(JSON.stringify(planShape), { status: 403 });
    expect((await readRunnerOriginRefusal(resp))?.origin).toBe(
      "http://localhost:3001"
    );
    await expect(resp.json()).resolves.toMatchObject({
      code: CROSS_ORIGIN_REFUSED,
    });
  });

  it("ignores a non-403 even with the code", async () => {
    const resp = new Response(JSON.stringify(planShape), { status: 400 });
    expect(await readRunnerOriginRefusal(resp)).toBeNull();
  });
});

describe("describeRunnerOriginRefusal", () => {
  it("names route, origin, class and both admit paths", () => {
    const msg = describeRunnerOriginRefusal(
      parseRunnerOriginRefusal(planShape)!
    );
    expect(msg).toContain("GET /sessions");
    expect(msg).toContain("http://localhost:3001 (trusted origin)");
    expect(msg).toContain("QONTINUI_RUNNER_ALLOWED_ORIGINS");
    expect(msg).toContain("api.allowed_origins");
  });

  it("degrades gracefully with no context", () => {
    const msg = describeRunnerOriginRefusal(
      parseRunnerOriginRefusal({ code: CROSS_ORIGIN_REFUSED })!
    );
    expect(msg).toContain("this route");
    expect(msg).toContain("this page's origin");
  });
});
