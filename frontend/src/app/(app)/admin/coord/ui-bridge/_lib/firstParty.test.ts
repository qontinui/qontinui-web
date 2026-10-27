/**
 * What the dashboard can attribute: the runner's own app, and nothing else
 * (D3.3 — text with no repository is withheld while presenting).
 */

import { describe, expect, it } from "vitest";
import { RUNNER_REPO, appRepoOf } from "./firstParty";

describe("appRepoOf", () => {
  it("attributes the runner's own app to the runner's repository", () => {
    expect(RUNNER_REPO).toBe("qontinui/qontinui-runner");
    expect(appRepoOf("qontinui-runner")).toBe("qontinui/qontinui-runner");
  });

  it("attributes no other app, however close its id", () => {
    for (const id of [
      "qontinui-web",
      "example-portal",
      "qontinui-runner-dev",
      "Qontinui-Runner",
      " qontinui-runner",
    ]) {
      expect(appRepoOf(id), id).toBeNull();
    }
  });

  it("attributes nothing to an app the reading does not name", () => {
    expect(appRepoOf(null)).toBeNull();
    expect(appRepoOf(undefined)).toBeNull();
    expect(appRepoOf("")).toBeNull();
  });
});
