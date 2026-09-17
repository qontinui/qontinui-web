/**
 * `isKeepaliveFrame` — the coord-events bridge's `{"type":"keepalive"}`
 * frame (finding 67329129) must not trigger `useMergePipelineData`'s
 * five-surface refetch. Pinned as a pure-function test rather than a full
 * hook render: the hook's `ws.onmessage` has no branch besides this check,
 * so the check is what needs covering, not the WS plumbing around it.
 */

import { describe, it, expect } from "vitest";
import { isKeepaliveFrame } from "./useMergePipelineData";

describe("isKeepaliveFrame", () => {
  it("is true for the bridge's exact keepalive frame", () => {
    expect(isKeepaliveFrame(JSON.stringify({ type: "keepalive" }))).toBe(
      true,
    );
  });

  it("is false for a real coord frame (has a channel)", () => {
    expect(
      isKeepaliveFrame(
        JSON.stringify({
          channel: "events.merge.proposal.updated.7",
          payload: "{}",
        }),
      ),
    ).toBe(false);
  });

  it("is false for a differently-typed frame, non-JSON, or a non-string", () => {
    expect(isKeepaliveFrame(JSON.stringify({ type: "ping" }))).toBe(false);
    expect(isKeepaliveFrame("not json")).toBe(false);
    expect(isKeepaliveFrame(undefined)).toBe(false);
    expect(isKeepaliveFrame(42)).toBe(false);
  });
});
