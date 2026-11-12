/**
 * DevicePicker — the device roster choice shared by `SpawnModal` and
 * `/admin/coord/runners`.
 *
 * `deviceStateLabel`'s cases moved here verbatim from `SpawnModal.test.ts`
 * when the picker was extracted (plan
 * `2026-09-13-drained-runner-never-reaches-idle` Phase 8).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DevicePicker,
  deviceStateLabel,
  findRosterDevice,
  hiddenDevicesNote,
  normalizeDeviceId,
  pickableDevices,
} from "./DevicePicker";

describe("deviceStateLabel", () => {
  const device = (state?: string, heartbeat_state?: string) => ({
    device_id: "00000000-0000-0000-0000-deadbeefcafe",
    hostname: "test-host",
    state,
    heartbeat_state,
  });

  it("shows the ladder state under a derived overlay", () => {
    // The case this exists for. `stale` is coord's derived overlay: the
    // heartbeat is fine and the resource sampler has gone quiet, so the box
    // is reachable and perfectly spawnable. An operator choosing a machine
    // needs to see that it is `healthy` underneath — coord ships
    // `heartbeat_state` precisely so the overlay loses nothing.
    expect(deviceStateLabel(device("stale", "healthy"))).toBe(
      "stale, heartbeat healthy"
    );
  });

  it("does not repeat a state that agrees with itself", () => {
    expect(deviceStateLabel(device("healthy", "healthy"))).toBe("healthy");
    expect(deviceStateLabel(device("degraded", "degraded"))).toBe("degraded");
  });

  it("keeps an unreachable machine unambiguous", () => {
    // `partitioned` is persisted, so coord reports it on both fields. The
    // label must stay a single word here: the whole point of the second
    // half is to distinguish a usable machine from a dead one, and adding
    // ", heartbeat partitioned" would dilute exactly that signal.
    expect(deviceStateLabel(device("partitioned", "partitioned"))).toBe(
      "partitioned"
    );
  });

  it("falls through to the verdict when coord predates the field", () => {
    // Absent is UNKNOWN. Falling back to `state` here would manufacture an
    // agreement the wire never claimed — and against an old coord, EVERY
    // row would silently claim it.
    expect(deviceStateLabel(device("stale", undefined))).toBe("stale");
    expect(deviceStateLabel(device("healthy", undefined))).toBe("healthy");
  });

  it("renders a state it has never heard of, rather than dropping it", () => {
    // The wire type is a bare string on purpose: a coord newer than this
    // build must render, not fail to parse. A future derived overlay gets
    // the same two-part treatment with no code change here.
    expect(deviceStateLabel(device("quarantined", "healthy"))).toBe(
      "quarantined, heartbeat healthy"
    );
  });

  it("is empty for a device coord has no verdict for", () => {
    // The caller guards on `d.state` before rendering, so an absent state
    // shows nothing at all rather than the word "undefined".
    expect(deviceStateLabel(device(undefined, undefined))).toBe("");
  });

  it("does not let a heartbeat stand in for a missing verdict", () => {
    // The interpolation trap: with no `state` and a `heartbeat_state` that
    // therefore cannot equal it, a naive implementation renders the literal
    // string "undefined, heartbeat healthy". `heartbeat_state` EXPLAINS a
    // verdict and cannot substitute for one — an absent state is `unknown`,
    // which is not this label's judgement to make.
    expect(deviceStateLabel(device(undefined, "healthy"))).toBe("");
  });
});

describe("findRosterDevice", () => {
  const roster = [
    { device_id: "aaaaaaaa-0000-4000-8000-000000000001", hostname: "one" },
    { device_id: "bbbbbbbb-0000-4000-8000-000000000002", hostname: "two" },
  ];

  it("matches a linked id regardless of case and surrounding space", () => {
    expect(
      findRosterDevice(roster, "  BBBBBBBB-0000-4000-8000-000000000002 ")
    ).toBe(roster[1]);
    expect(normalizeDeviceId(" AbC ")).toBe("abc");
  });

  it("finds nothing for an empty selection or an unlisted id", () => {
    expect(findRosterDevice(roster, "")).toBeUndefined();
    expect(
      findRosterDevice(roster, "cccccccc-0000-4000-8000-000000000003")
    ).toBeUndefined();
  });
});

describe("DevicePicker", () => {
  it("renders a labelable trigger carrying the caller's test id", () => {
    render(
      <DevicePicker
        id="picker"
        devices={[]}
        value=""
        onChange={vi.fn()}
        data-testid="the-picker"
      />
    );
    const trigger = screen.getByTestId("the-picker");
    expect(trigger).toHaveAttribute("id", "picker");
    expect(trigger).toHaveTextContent("Choose a device");
  });
});

describe("pickableDevices", () => {
  const machine = {
    device_id: "aaaaaaaa-0000-4000-8000-000000000001",
    hostname: "nilan",
    state: "healthy",
    ci_runner_status: null,
  };
  const quietMachine = {
    device_id: "aaaaaaaa-0000-4000-8000-000000000002",
    hostname: "nawa",
    state: "partitioned",
    ci_runner_status: null,
  };
  const deadMachine = {
    device_id: "aaaaaaaa-0000-4000-8000-000000000003",
    hostname: "old-box",
    state: "abandoned",
    ci_runner_status: null,
  };
  const jitRow = {
    device_id: "aaaaaaaa-0000-4000-8000-000000000004",
    hostname:
      "gh-runner-dell-2016-ccfg-1-1794059286@qontinui/qontinui-claude-config",
    state: "abandoned",
    ci_runner_status: "busy",
  };
  const liveCiRow = {
    device_id: "aaaaaaaa-0000-4000-8000-000000000005",
    hostname: "gh-runner-dell-2020-ccfg-1@qontinui/qontinui-claude-config",
    state: "healthy",
    ci_runner_status: "idle",
  };

  it("offers every runner machine, abandoned ones last, and leaves out CI rows", () => {
    const p = pickableDevices([
      deadMachine,
      machine,
      quietMachine,
      jitRow,
      liveCiRow,
    ]);
    // An abandoned machine is still a machine an operator looks for by name;
    // it is listed after the reachable ones, not hidden.
    expect(p.shown.map((d) => d.hostname)).toEqual([
      "nilan",
      "nawa",
      "old-box",
    ]);
    expect(p.hiddenCiRunners).toBe(2);
  });

  it("keeps a row whose CI status is unknown (an older coord)", () => {
    // Absent `ci_runner_status` is "not known to be a CI runner".
    const p = pickableDevices([
      { device_id: "x", hostname: "h", state: "healthy" },
    ]);
    expect(p.shown).toHaveLength(1);
  });

  it("says what it left out, and nothing when it left out nothing", () => {
    expect(
      hiddenDevicesNote(
        pickableDevices([machine, deadMachine, jitRow, liveCiRow])
      )
    ).toBe("2 CI runner registrations hidden");
    expect(
      hiddenDevicesNote(pickableDevices([machine, deadMachine]))
    ).toBeNull();
  });

  it("still renders a deep-linked selection the picker would not offer", () => {
    render(
      <DevicePicker
        devices={[machine, jitRow]}
        value={jitRow.device_id}
        onChange={vi.fn()}
        data-testid="the-picker"
      />
    );
    expect(screen.getByTestId("the-picker")).toHaveTextContent(
      "gh-runner-dell-2016-ccfg-1-1794059286"
    );
  });

  it("states what it hid beside the trigger, without opening the list", () => {
    render(
      <DevicePicker devices={[machine, jitRow]} value="" onChange={vi.fn()} />
    );
    expect(screen.getByTestId("device-picker-hidden-note")).toHaveTextContent(
      "1 CI runner registration hidden"
    );
  });
});
