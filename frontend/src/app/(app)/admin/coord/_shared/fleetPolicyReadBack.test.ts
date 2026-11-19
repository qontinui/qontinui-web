/**
 * `rereadAfterFailedReadBack` and `resolvedOtherwise` on their own (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 7-8):
 * the re-read a dial sends after a failed read-back says what the read-back
 * would have said, and a re-read that throws is reported through the dial,
 * never left as an unhandled rejection. Only the read is guarded: a throw
 * from what is said after it is never reported as a failed read. The dials'
 * own suites hold the same sentences through each hook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import {
  rereadAfterFailedReadBack,
  resolvedOtherwise,
  type RereadAfterWrite,
} from "./fleetPolicyReadBack";

function view(level: string, scope = "tenant"): FleetPolicyView {
  return {
    domain: "some_dial",
    effective_level: level,
    master_enabled: true,
    resolved_scope: scope,
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
  };
}

/** What a dial hands the helper after writing `on`. */
const AFTER_WRITING_ON: Pick<
  RereadAfterWrite,
  "level" | "confirmed" | "resolvers"
> = {
  level: "on",
  confirmed: 'Some dial: now "on" for this tenant.',
  resolvers: "devices resolve",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvedOtherwise", () => {
  it("names what was written, who resolves what, and from which scope", () => {
    expect(
      resolvedOtherwise("on", "devices resolve", view("off", "repo"))
    ).toBe('Wrote "on", but devices resolve "off" (from the repo scope).');
    expect(resolvedOtherwise("on", "the worker resolves", view("off"))).toBe(
      'Wrote "on", but the worker resolves "off" (from the tenant scope).'
    );
  });
});

describe("rereadAfterFailedReadBack", () => {
  it("says the level written is now in force when coord resolves it", async () => {
    const onError = vi.fn();
    await rereadAfterFailedReadBack({
      ...AFTER_WRITING_ON,
      read: async () => view("on"),
      onError,
    });

    expect(toast.success).toHaveBeenCalledWith(
      'Some dial: now "on" for this tenant.'
    );
    expect(toast.warning).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("warns as a read-back does when coord resolves another level", async () => {
    const onError = vi.fn();
    await rereadAfterFailedReadBack({
      ...AFTER_WRITING_ON,
      read: async () => view("off", "repo"),
      onError,
    });

    expect(toast.warning).toHaveBeenCalledWith(
      'Wrote "on", but devices resolve "off" (from the repo scope).'
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("says nothing for a read that failed or was discarded: its own error speaks", async () => {
    const onError = vi.fn();
    await rereadAfterFailedReadBack({
      ...AFTER_WRITING_ON,
      read: async () => null,
      onError,
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a read that throws through the dial, and settles", async () => {
    const onError = vi.fn();
    const failure = new Error("the read threw");

    await expect(
      rereadAfterFailedReadBack({
        ...AFTER_WRITING_ON,
        read: async () => {
          throw failure;
        },
        onError,
      })
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("never reports a throw from what it says after the read as a failed read", async () => {
    // The read confirmed the level; a toast that throws is not the read's
    // failure, so the dial's read error stays clear of it.
    const onError = vi.fn();
    const toastFailure = new Error("the toast threw");
    vi.mocked(toast.success).mockImplementationOnce(() => {
      throw toastFailure;
    });

    await expect(
      rereadAfterFailedReadBack({
        ...AFTER_WRITING_ON,
        read: async () => view("on"),
        onError,
      })
    ).rejects.toBe(toastFailure);

    expect(onError).not.toHaveBeenCalled();
  });
});
