/**
 * One classification for every failed runner read, and the labelled UNKNOWN
 * it renders — above all, that a 403 from a runner whose build predates the
 * dashboard's relay entries NAMES that build.
 */

import { describe, expect, it } from "vitest";
import { RUNNER_NEEDS_LOCAL } from "@/lib/runner/api-client";
import { RunnerRelayError } from "@/app/(app)/digital-twin/_lib/runner-relay";
import { RUNNER_ROUTES } from "./relayReads";
import {
  buildLabel,
  noRunnerReason,
  sameIssue,
  sourceIssueOf,
  sourceIssueText,
  type BuildReading,
} from "./relaySource";

const BUILD: BuildReading = {
  state: "known",
  buildId: "be39991d2fe9-1761210000000",
  gitSha: "be39991d2fe9",
};

const notCarried = () =>
  new RunnerRelayError(
    "This action needs the runner on this machine",
    403,
    {},
    RUNNER_NEEDS_LOCAL
  );

describe("sourceIssueOf", () => {
  it("reads the relay's 403 path refusal as not carried", () => {
    expect(sourceIssueOf(notCarried())).toEqual({ kind: "not-carried" });
  });

  it("reads the runner's egress refusal as withheld, with its sentence", () => {
    const err = new RunnerRelayError("x", 409, {}, undefined, {
      reason: "egress_off",
      message: "Terminal streaming is off for this project",
    });
    expect(sourceIssueOf(err)).toEqual({
      kind: "withheld",
      message: "Terminal streaming is off for this project",
    });
  });

  it("explains anything else in the twin's relay-failure words, keeping the request id", () => {
    const err = new RunnerRelayError("x", 503, {
      detail: "runner not connected",
      wsConnectedAt: null,
      requestId: "req-1",
    });
    const issue = sourceIssueOf(err);
    expect(issue.kind).toBe("failed");
    if (issue.kind !== "failed") return;
    expect(issue.cause).toMatch(/never registered a relay session/);
    expect(issue.requestId).toBe("req-1");
  });

  it("reads a plain error by its message", () => {
    expect(sourceIssueOf(new Error("boom"))).toEqual({
      kind: "failed",
      cause: "boom",
      requestId: null,
    });
  });
});

describe("sourceIssueText", () => {
  it("names the runner build for a route this build's relay predates", () => {
    const text = sourceIssueText(
      { kind: "not-carried" },
      RUNNER_ROUTES.components,
      BUILD
    );
    expect(text).toContain("HTTP 403");
    expect(text).toContain("build be39991d2fe9-1761210000000");
    expect(text).toContain("predates the relay entries this page reads");
    expect(text).not.toMatch(/^UNKNOWN/);
  });

  it("says no build carries a route that none does — not 'rebuild this one'", () => {
    const text = sourceIssueText(
      { kind: "not-carried" },
      RUNNER_ROUTES.visibility,
      BUILD
    );
    expect(text).toBe(
      "No runner's relay carries the occlusion sweep yet, so this runner (build be39991d2fe9-1761210000000) answered HTTP 403."
    );
  });

  it("still says the build is unknown, and why, when health did not answer", () => {
    const text = sourceIssueText(
      { kind: "not-carried" },
      RUNNER_ROUTES.pageHealth,
      {
        state: "unknown",
        reason: "its health did not answer",
      }
    );
    expect(text).toContain(
      "a build this page could not read (its health did not answer)"
    );
  });

  it("words the other arms as sentences", () => {
    expect(
      sourceIssueText(
        {
          kind: "withheld",
          message: "Terminal streaming is off for this project",
        },
        RUNNER_ROUTES.snapshot,
        BUILD
      )
    ).toBe(
      "The runner withheld a live snapshot of the runner's screen: Terminal streaming is off for this project."
    );
    expect(
      sourceIssueText(
        {
          kind: "failed",
          cause: "The relay answered HTTP 504.",
          requestId: null,
        },
        RUNNER_ROUTES.components,
        BUILD
      )
    ).toBe(
      "The runner's component actions could not be read: The relay answered HTTP 504."
    );
    expect(
      sourceIssueText(
        { kind: "no-runner", reason: "the runner list has not answered yet" },
        RUNNER_ROUTES.health,
        BUILD
      )
    ).toBe(
      "Nothing was asked for the runner's health and build: the runner list has not answered yet."
    );
  });
});

describe("buildLabel", () => {
  it("prefers the build id, then the commit, then says it names none", () => {
    expect(buildLabel(BUILD)).toBe("build be39991d2fe9-1761210000000");
    expect(buildLabel({ state: "known", buildId: null, gitSha: "abc" })).toBe(
      "commit abc"
    );
    expect(buildLabel({ state: "known", buildId: null, gitSha: null })).toBe(
      "a build that names no id"
    );
  });
});

describe("noRunnerReason", () => {
  it("is null for a runner target and a reason for every other", () => {
    expect(
      noRunnerReason({
        kind: "runner",
        runner: { id: "d" },
        locality: "unknown",
      })
    ).toBeNull();
    expect(noRunnerReason({ kind: "pending" })).toMatch(/has not answered/);
    expect(noRunnerReason({ kind: "default_local" })).toMatch(
      /no runner is paired/
    );
    expect(
      noRunnerReason({ kind: "unavailable", reason: "no_eligible_runner" })
    ).toMatch(/none of your runners/);
    expect(
      noRunnerReason({
        kind: "unavailable",
        reason: "resolver_unavailable",
        message: "coord said no",
      })
    ).toBe("coord said no");
  });
});

describe("sameIssue", () => {
  it("matches two reads that failed alike, whatever their request ids", () => {
    expect(
      sameIssue(
        { kind: "failed", cause: "c", requestId: "1" },
        { kind: "failed", cause: "c", requestId: "2" }
      )
    ).toBe(true);
    expect(
      sameIssue(
        { kind: "failed", cause: "c", requestId: null },
        { kind: "failed", cause: "d", requestId: null }
      )
    ).toBe(false);
    expect(sameIssue({ kind: "not-carried" }, { kind: "not-carried" })).toBe(
      true
    );
    expect(
      sameIssue({ kind: "not-carried" }, { kind: "withheld", message: null })
    ).toBe(false);
  });
});
