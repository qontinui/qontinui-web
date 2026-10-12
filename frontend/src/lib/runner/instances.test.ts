/**
 * `Runner.instances` as the "Run on:" picker describes it (plan
 * 2026-09-23-runner-selector-follow-ups-drain-aware-background-dispatch-and-typed-instances,
 * Phase 3).
 *
 * The field is typed, but the row is JSON nothing validates on arrival, so
 * the cases the type cannot express are pinned here: a backend that omits the
 * field reads as `null` (not reported), never as "no instances"; an entry with
 * no string `instanceKey` is dropped; a non-number `port` is left out.
 */

import type { Runner } from "@qontinui/shared-types";
import { describe, expect, it } from "vitest";
import {
  describeRunnerInstances,
  readRunnerInstances,
  type RunnerInstance,
} from "./instances";

const PRIMARY: RunnerInstance = {
  instanceKey: "primary",
  instanceRole: "primary",
  port: 9876,
  connectedAt: "2026-09-23T00:00:00Z",
};

const SECONDARY: RunnerInstance = {
  instanceKey: "runner:abc",
  instanceRole: "secondary",
  port: 9877,
  connectedAt: "2026-09-23T00:05:00Z",
};

function runner(instances: RunnerInstance[]): Runner {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Desk runner",
    port: 9876,
    capabilities: [],
    createdAt: "2026-09-23T00:00:00Z",
    derivedStatus: "healthy",
    instances,
    userId: "u1",
    wsConnected: true,
  };
}

/**
 * The row as a backend that predates `instances` serves it: the field is
 * absent. Built through JSON, as the real row is, because the type cannot
 * spell a row that omits a required field.
 */
function withoutInstances(row: Runner): Runner {
  const wire: Partial<Runner> = { ...row };
  delete wire.instances;
  return JSON.parse(JSON.stringify(wire));
}

describe("readRunnerInstances", () => {
  it("is null when the row does not report the field", () => {
    expect(readRunnerInstances(withoutInstances(runner([PRIMARY])))).toBeNull();
  });

  it("is the reported list, empty included", () => {
    expect(readRunnerInstances(runner([]))).toEqual([]);
    expect(readRunnerInstances(runner([PRIMARY, SECONDARY]))).toEqual([
      PRIMARY,
      SECONDARY,
    ]);
  });

  it("drops an entry that has no string instanceKey", () => {
    const row: Runner = JSON.parse(
      JSON.stringify({
        ...runner([PRIMARY]),
        instances: [null, { port: 9877 }, PRIMARY],
      })
    );
    expect(readRunnerInstances(row)).toEqual([PRIMARY]);
    expect(describeRunnerInstances(row)).toBe("1 instance: primary :9876");
  });
});

describe("describeRunnerInstances with a port that is not a number", () => {
  it("names the instance by its key alone", () => {
    const row: Runner = JSON.parse(
      JSON.stringify({
        ...runner([PRIMARY]),
        instances: [
          { ...PRIMARY, port: "9876" },
          { ...SECONDARY, port: {} },
        ],
      })
    );
    expect(describeRunnerInstances(row)).toBe(
      "2 instances: primary, runner:abc"
    );
  });
});

describe("describeRunnerInstances", () => {
  it("is null when the row does not report the field", () => {
    expect(
      describeRunnerInstances(withoutInstances(runner([PRIMARY])))
    ).toBeNull();
  });

  it("is null for an empty list", () => {
    expect(describeRunnerInstances(runner([]))).toBeNull();
  });

  it("describes one instance", () => {
    expect(describeRunnerInstances(runner([PRIMARY]))).toBe(
      "1 instance: primary :9876"
    );
  });

  it("describes two instances with their ports", () => {
    expect(describeRunnerInstances(runner([PRIMARY, SECONDARY]))).toBe(
      "2 instances: primary :9876, runner:abc :9877"
    );
  });

  it("names an instance without a port by its key alone", () => {
    const { port: _port, ...portOmitted } = SECONDARY;
    expect(
      describeRunnerInstances(runner([{ ...PRIMARY, port: null }, portOmitted]))
    ).toBe("2 instances: primary, runner:abc");
  });
});
