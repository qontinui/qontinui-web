import { describe, expect, it } from "vitest";
import { githubHostRefusal } from "./githubHostRefusal";

/** A rejection in the exact shape `readJson` throws. */
function rejection(status: number, body: unknown): Error {
  return new Error(
    `PUT /api/v1/operations/tenant/github-host failed: ${status} - ${JSON.stringify(body)}`
  );
}

describe("githubHostRefusal", () => {
  it("names the repos blocking a host change", () => {
    const repos = [
      { repo: "acme/app", github_remote: "https://github.com/acme/app.git" },
    ];
    const r = githubHostRefusal(
      rejection(409, {
        detail: { error: "repos_registered_on_another_host", repos },
      })
    );
    expect(r.code).toBe("repos_registered_on_another_host");
    expect(r.repos).toEqual(repos);
    expect(r.message).toMatch(/Re-register them/);
  });

  it("appends coord's reason to an invalid-host refusal", () => {
    const r = githubHostRefusal(
      rejection(400, {
        detail: {
          error: "invalid_github_host",
          detail: "api_base must be https",
        },
      })
    );
    expect(r.code).toBe("invalid_github_host");
    expect(r.message).toMatch(/: api_base must be https$/);
    expect(r.repos).toBeNull();
  });

  it("falls back to coord's own detail for a code it does not know", () => {
    const r = githubHostRefusal(
      rejection(500, { detail: { error: "write_failed", detail: "boom" } })
    );
    expect(r.code).toBe("write_failed");
    expect(r.message).toBe("boom");
  });

  it("carries no code for a failure that is not a status rejection", () => {
    const r = githubHostRefusal(new TypeError("Failed to fetch"));
    expect(r).toEqual({ code: null, message: "Failed to fetch", repos: null });
  });

  it("carries no code for an unstructured error body", () => {
    const r = githubHostRefusal(
      new Error(
        "PUT /api/v1/operations/tenant/github-host failed: 502 - <html>"
      )
    );
    expect(r.code).toBeNull();
    expect(r.repos).toBeNull();
  });
});
