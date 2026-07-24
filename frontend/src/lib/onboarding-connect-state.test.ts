/**
 * Wire-format tests for the GitHub-connect `state` round-trip, including the
 * P2 runner return nonce (4th field) — see onboarding-connect-state.ts.
 */

import { describe, expect, it } from "vitest";
import {
  beginConnectState,
  isValidRunnerState,
  parseConnectState,
} from "./onboarding-connect-state";

const RUNNER_NONCE = "a".repeat(64); // shape the runner actually mints (256-bit hex)

describe("isValidRunnerState", () => {
  it("accepts hex nonces within bounds", () => {
    expect(isValidRunnerState(RUNNER_NONCE)).toBe(true);
    expect(isValidRunnerState("DEADbeef00112233")).toBe(true); // 16 chars, mixed case
  });

  it("rejects null, short, long, and non-hex values", () => {
    expect(isValidRunnerState(null)).toBe(false);
    expect(isValidRunnerState("")).toBe(false);
    expect(isValidRunnerState("abc")).toBe(false); // too short
    expect(isValidRunnerState("g".repeat(64))).toBe(false); // non-hex
    expect(isValidRunnerState("a".repeat(129))).toBe(false); // too long
    // URL/scheme metacharacters must never pass — the value is embedded in a
    // qontinui:// deep link later.
    expect(isValidRunnerState("abcd1234?x=1&y=2")).toBe(false);
    expect(isValidRunnerState("runner-clone")).toBe(false);
  });
});

describe("parseConnectState", () => {
  it("parses the legacy bare runner value", () => {
    expect(parseConnectState("runner-clone")).toEqual({
      flow: "runner-clone",
      login: null,
      nonce: null,
      runnerState: null,
    });
  });

  it("parses the 3-field browser shape without a runner nonce", () => {
    expect(parseConnectState("connect~my-org~deadbeef")).toEqual({
      flow: "connect",
      login: "my-org",
      nonce: "deadbeef",
      runnerState: null,
    });
  });

  it("parses the 4-field shape and validates the runner nonce", () => {
    expect(
      parseConnectState(`runner-clone~~deadbeef~${RUNNER_NONCE}`),
    ).toEqual({
      flow: "runner-clone",
      login: null,
      nonce: "deadbeef",
      runnerState: RUNNER_NONCE,
    });
    // A malformed 4th field is dropped, not propagated.
    expect(
      parseConnectState("runner-clone~~deadbeef~not-hex!"),
    ).toMatchObject({ runnerState: null });
  });

  it("rejects unknown flows and empty input", () => {
    expect(parseConnectState(null)).toBeNull();
    expect(parseConnectState("")).toBeNull();
    expect(parseConnectState(`evil~org~n~${RUNNER_NONCE}`)).toBeNull();
  });
});

describe("beginConnectState", () => {
  it("keeps the legacy 3-field shape when no runner nonce is given", () => {
    const state = beginConnectState("connect", "my-org");
    expect(state.split("~")).toHaveLength(3);
    expect(parseConnectState(state)).toMatchObject({
      flow: "connect",
      login: "my-org",
      runnerState: null,
    });
  });

  it("appends a valid runner nonce as the 4th field and round-trips it", () => {
    const state = beginConnectState("runner-clone", "", RUNNER_NONCE);
    expect(state.split("~")).toHaveLength(4);
    expect(parseConnectState(state)).toMatchObject({
      flow: "runner-clone",
      login: null,
      runnerState: RUNNER_NONCE,
    });
  });

  it("silently drops an invalid runner nonce (falls back to legacy shape)", () => {
    const state = beginConnectState("runner-clone", "", "not?hex");
    expect(state.split("~")).toHaveLength(3);
  });
});
