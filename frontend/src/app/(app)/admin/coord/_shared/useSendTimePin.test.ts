/**
 * `useFirstPinnedRead` on its own: a hook's first read is sent once, at the
 * first commit where the pin names a project, and the hook says it is
 * waiting until that read has been sent (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 5-6).
 * The pin is asked after each commit, never depended on, so each case drives
 * commits with `rerender` and moves the pin between them.
 */

import { createElement, StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ProjectPin } from "@/services/http-client";
import {
  useFirstPinnedRead,
  useSendTimePin,
  type ResolvePin,
} from "./useSendTimePin";

/** A hook as a section uses the two: one resolver identity, and the read. */
function useSection(resolvePin: ResolvePin | undefined, read: () => void) {
  const sendPin = useSendTimePin(resolvePin);
  return useFirstPinnedRead(sendPin, read);
}

/** A section whose resolver answers `current.pin` when asked. */
function mountSection(
  current: { pin: ProjectPin | undefined },
  options: { wrapper?: (props: { children: ReactNode }) => ReactNode } = {}
) {
  const read = vi.fn();
  const rendered = renderHook(
    () => useSection(() => current.pin, read),
    options
  );
  return { read, ...rendered };
}

const strict = ({ children }: { children: ReactNode }) =>
  createElement(StrictMode, null, children);

describe("useFirstPinnedRead", () => {
  it("reads at the first commit when the pin is there, and never again", () => {
    const current = { pin: { tenant: "t-b" } as ProjectPin | undefined };
    const { read, result, rerender } = mountSection(current);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);

    current.pin = { tenant: "t-c" };
    rerender();
    current.pin = undefined;
    rerender();
    current.pin = { tenant: "t-b" };
    rerender();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while no pin appears, and says it is waiting", () => {
    const current = { pin: undefined as ProjectPin | undefined };
    const { read, result, rerender } = mountSection(current);
    rerender();
    rerender();

    expect(read).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });

  it("reads once when the pin first appears after the first commit", () => {
    const current = { pin: undefined as ProjectPin | undefined };
    const { read, result, rerender } = mountSection(current);
    expect(read).not.toHaveBeenCalled();

    current.pin = { tenant: "t-b" };
    rerender();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);

    rerender();
    current.pin = { tenant: "t-c" };
    rerender();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads once under StrictMode's double effects, pinned at mount or not", () => {
    const pinned = { pin: { tenant: "t-b" } as ProjectPin | undefined };
    const early = mountSection(pinned, { wrapper: strict });
    early.rerender();
    expect(early.read).toHaveBeenCalledTimes(1);

    const unpinned = { pin: undefined as ProjectPin | undefined };
    const late = mountSection(unpinned, { wrapper: strict });
    expect(late.read).not.toHaveBeenCalled();
    unpinned.pin = { tenant: "t-b" };
    late.rerender();
    late.rerender();
    expect(late.read).toHaveBeenCalledTimes(1);
  });

  it("reads once a resolver that arrives after the first commit names a project", () => {
    const read = vi.fn();
    let resolvePin: ResolvePin | undefined = undefined;
    const { rerender } = renderHook(() => useSection(resolvePin, read));
    rerender();
    resolvePin = () => undefined;
    rerender();
    expect(read).not.toHaveBeenCalled();

    resolvePin = () => ({ tenant: "t-b" });
    rerender();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("says it is waiting until its first read is sent, when the pin appears after mount", () => {
    // Every render as a section sees it: whether a pin was there, what the
    // hook said, and how many reads had gone out before it rendered.
    const renders: { pinned: boolean; waiting: boolean; reads: number }[] = [];
    const current = { pin: undefined as ProjectPin | undefined };
    const read = vi.fn();
    const { rerender } = renderHook(() => {
      const waiting = useSection(() => current.pin, read);
      renders.push({
        pinned: current.pin !== undefined,
        waiting,
        reads: read.mock.calls.length,
      });
      return waiting;
    });

    current.pin = { tenant: "t-b" };
    rerender();

    expect(read).toHaveBeenCalledTimes(1);
    // The commit where the pin appeared still said waiting: its effect sent
    // the read, and only a render after that stops waiting.
    expect(renders).toContainEqual({ pinned: true, waiting: true, reads: 0 });
    expect(renders.filter((r) => !r.waiting)).not.toHaveLength(0);
    for (const r of renders.filter((r) => !r.waiting)) {
      expect(r.reads).toBe(1);
    }
  });

  it("says nothing is waiting from its first render when the pin is there at mount", () => {
    // A hook with a pin at mount is loading from its first render, so a
    // section with a project then never shows its waiting line.
    const said: boolean[] = [];
    const current = { pin: { tenant: "t-b" } as ProjectPin | undefined };
    const read = vi.fn();
    const { rerender } = renderHook(() => {
      const waiting = useSection(() => current.pin, read);
      said.push(waiting);
      return waiting;
    });
    rerender();

    expect(read).toHaveBeenCalledTimes(1);
    expect(said).not.toContain(true);
  });
});
