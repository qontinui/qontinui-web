/**
 * usePolicyAutoPublishPolicy on its own: it reads only under the page's pin,
 * and a read that began before a level write landed does not paint the
 * level from before the write (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 4-6).
 * On the page that race comes through the dial's Retry, which stays enabled
 * while a level write is in flight (`PromptDocumentsPageSettingsCrossTab`);
 * here it is driven directly, through `reload`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";

const fetchFleetPolicy = vi.fn();
const putFleetPolicy = vi.fn();
vi.mock("@/lib/api/operations/tenantPolicy", () => ({
  fetchFleetPolicy: (...args: unknown[]) => fetchFleetPolicy(...args),
  putFleetPolicy: (...args: unknown[]) => putFleetPolicy(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { usePolicyAutoPublishPolicy } from "./usePolicyAutoPublishPolicy";
import {
  PINNED_PAGE,
  testPageGuard,
  withPageGuard,
} from "../__fixtures__/pageWriteGuard";

const view = (level: string) => ({
  domain: "policy_auto_publish",
  effective_level: level,
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
});
const written = (level: string) => ({
  ok: true,
  domain: "policy_auto_publish",
  written_level: level,
  written_master_enabled: true,
  versioned: true,
  version: 2,
  updated_by: "operator@example.com",
  effective: view(level),
  readback_error: null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePolicyAutoPublishPolicy", () => {
  it("reads nothing while the page has no project, a reload included, and says it is waiting", async () => {
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(testPageGuard()),
    });
    await act(async () => {
      await result.current.reload();
    });

    expect(fetchFleetPolicy).not.toHaveBeenCalled();
    expect(result.current.waitingForProject).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.policy).toBeNull();
  });

  it("reads once, pinned, under the page's project", async () => {
    fetchFleetPolicy.mockResolvedValue(view("off"));
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    expect(fetchFleetPolicy.mock.calls).toEqual([
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
    ]);
    expect(result.current.waitingForProject).toBe(false);
  });

  it("reads again, pinned, after a write whose read-back failed, and shows coord's level", async () => {
    fetchFleetPolicy
      .mockResolvedValueOnce(view("off"))
      .mockResolvedValueOnce(view("on"));
    putFleetPolicy.mockResolvedValueOnce({
      ...written("on"),
      effective: null,
      readback_error: "read-back timed out",
    });
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    await act(async () => {
      await result.current.setLevel("on");
    });

    await waitFor(() =>
      expect(result.current.policy?.effective_level).toBe("on")
    );
    expect(result.current.readbackError).toBeNull();
    expect(fetchFleetPolicy.mock.calls).toEqual([
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
    ]);
    // Coord resolves what was written: the re-read says so, as a read-back
    // does, and the only warning is the read-back's own.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Automatic publishing is now "on".'
      )
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("after a write whose read-back failed, warns as a read-back does when coord resolves another level", async () => {
    fetchFleetPolicy
      .mockResolvedValueOnce(view("off"))
      .mockResolvedValueOnce({ ...view("off"), resolved_scope: "repo" });
    putFleetPolicy.mockResolvedValueOnce({
      ...written("on"),
      effective: null,
      readback_error: "read-back timed out",
    });
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    await act(async () => {
      await result.current.setLevel("on");
    });

    await waitFor(() =>
      expect(toast.warning).toHaveBeenLastCalledWith(
        'Wrote "on", but the worker resolves "off" (from the repo scope).'
      )
    );
    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.readbackError).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the last level, the read-back warning and the read error when the re-read fails", async () => {
    fetchFleetPolicy
      .mockResolvedValueOnce(view("off"))
      .mockRejectedValueOnce(new Error("coord is not reachable"));
    putFleetPolicy.mockResolvedValueOnce({
      ...written("on"),
      effective: null,
      readback_error: "read-back timed out",
    });
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    await act(async () => {
      await result.current.setLevel("on");
    });

    await waitFor(() =>
      expect(result.current.error).toBe("coord is not reachable")
    );
    expect(fetchFleetPolicy).toHaveBeenCalledTimes(2);
    expect(result.current.policy?.effective_level).toBe("off");
    expect(result.current.readbackError).toBe("read-back timed out");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses a write beside its send when the page names no project, whatever its guard allowed", async () => {
    // A guard the page's provider never builds — a write allowed with no
    // pin — so only the hook's own refusal can stop the send.
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(testPageGuard({ writeAllowed: () => true })),
    });
    let sentWrite: boolean | undefined;
    await act(async () => {
      sentWrite = await result.current.setLevel("off");
    });

    expect(sentWrite).toBe(false);
    expect(putFleetPolicy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Nothing was sent: this page has no project to send a change in. Select a project, or reload the page."
    );
  });

  it("shows its waiting line or its loading line at every render until its first read lands, when the project arrives after mount", async () => {
    // What a section renders from the hook at each render: waiting, loading,
    // or a level. A render with none of them would show the section empty.
    let pin: { tenant: string } | undefined = undefined;
    const answer = deferred<unknown>();
    fetchFleetPolicy.mockReturnValueOnce(answer.promise);
    const states: { waiting: boolean; loading: boolean; read: boolean }[] = [];
    const guard = testPageGuard({ resolvePin: () => pin });
    const { result, rerender } = renderHook(
      () => {
        const dial = usePolicyAutoPublishPolicy();
        states.push({
          waiting: dial.waitingForProject,
          loading: dial.loading,
          read: dial.policy !== null,
        });
        return dial;
      },
      { wrapper: withPageGuard(guard) }
    );

    pin = { tenant: "t-page" };
    rerender();
    await act(async () => answer.resolve(view("off")));
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    expect(fetchFleetPolicy).toHaveBeenCalledTimes(1);
    for (const state of states) {
      expect(state.waiting || state.loading || state.read).toBe(true);
    }
  });

  it("shows its loading line or a level at every render, with the project there at mount", async () => {
    const answer = deferred<unknown>();
    fetchFleetPolicy.mockReturnValueOnce(answer.promise);
    const states: { waiting: boolean; loading: boolean; read: boolean }[] = [];
    const { result } = renderHook(
      () => {
        const dial = usePolicyAutoPublishPolicy();
        states.push({
          waiting: dial.waitingForProject,
          loading: dial.loading,
          read: dial.policy !== null,
        });
        return dial;
      },
      { wrapper: withPageGuard(PINNED_PAGE) }
    );
    await act(async () => answer.resolve(view("off")));
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    expect(fetchFleetPolicy).toHaveBeenCalledTimes(1);
    expect(states.some((state) => state.waiting)).toBe(false);
    for (const state of states) {
      expect(state.loading || state.read).toBe(true);
    }
  });

  it("does not paint a read sent before a level write landed over the write's result", async () => {
    fetchFleetPolicy.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    // A read goes out, and coord answers it with the level before the write.
    const before = deferred<unknown>();
    fetchFleetPolicy.mockReturnValueOnce(before.promise);
    let reading: Promise<void> = Promise.resolve();
    act(() => {
      reading = result.current.reload();
    });
    putFleetPolicy.mockResolvedValueOnce(written("on"));
    await act(async () => {
      await result.current.setLevel("on");
    });
    expect(result.current.policy?.effective_level).toBe("on");

    await act(async () => {
      before.resolve(view("off"));
      await reading;
    });

    expect(result.current.policy?.effective_level).toBe("on");
  });
});

/**
 * The level vocabulary. Since qontinui-coord#4239, coord serves the typed
 * default as `effective_level` when no row matches (before it, that answer
 * read `"off"`):
 *
 * | Row | `effective_level` | `resolved_scope` | In force |
 * |---|---|---|---|
 * | none | `"on"` — coord's typed default | `"none"` | `on`, flagged defaulted |
 * | present, master off | `"off"` | the band | `off` — an operator's choice |
 * | present, unparseable level | the raw string | the band | `off` — fail-closed |
 * | none, unparseable level | the raw string | `"none"` | UNKNOWN — vocabulary skew |
 */
describe("usePolicyAutoPublishPolicy — the level in force", () => {
  async function render(v: object) {
    fetchFleetPolicy.mockResolvedValue(v);
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());
    return result;
  }

  it("shows coord's served default for a missing row and flags it as defaulted", async () => {
    const result = await render({
      ...view("on"),
      master_enabled: false,
      resolved_scope: "none",
    });

    expect(result.current.displayLevel).toBe("on");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
  });

  it("honours a master-disabled row as off", async () => {
    const result = await render({ ...view("off"), master_enabled: false });

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
  });

  it("resolves an unparseable row fail-closed and keeps the raw string", async () => {
    const result = await render(view("sometimes"));

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(false);
    expect(result.current.unrecognizedLevel).toBe("sometimes");
  });

  it("shows a no-row answer whose served level is unparseable as UNKNOWN", async () => {
    // Vocabulary skew: coord serving, with no row, a default this console does
    // not know. Coord enforces that default, so `off` would be false; the
    // console used to substitute its own copy of `on` here, which masked this.
    const result = await render({
      ...view("sometimes"),
      master_enabled: false,
      resolved_scope: "none",
    });

    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.defaultUnreadable).toBe(true);
    expect(result.current.displayLevel).toBeNull();
    expect(result.current.unrecognizedLevel).toBe("sometimes");
  });

  it("reads the served default rather than a console copy of it", async () => {
    // Not the old console constant `on`: a revert to it fails this.
    const result = await render({
      ...view("off"),
      master_enabled: false,
      resolved_scope: "none",
    });

    expect(result.current.displayLevel).toBe("off");
    expect(result.current.isDefaulted).toBe(true);
    expect(result.current.unrecognizedLevel).toBeNull();
  });
});
