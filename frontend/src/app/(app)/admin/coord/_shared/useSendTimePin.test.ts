/**
 * The send-time pin's two helpers on their own.
 *
 * - `useRetakeOnceWhenPinned` re-takes a hook's reads once, the first time a
 *   pin appears after reads went out with none, and never otherwise (plan
 *   `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 3-4).
 *   The pin is asked after each commit, never depended on, so each case here
 *   drives commits with `rerender` and moves the pin between them.
 * - `readPinAtSend` is the pin a read with no page pin is sent with: the
 *   project stored at that moment, or none.
 */

import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ProjectPin } from "@/services/http-client";
import {
  readPinAtSend,
  useRetakeOnceWhenPinned,
  useSendTimePin,
  type ResolvePin,
} from "./useSendTimePin";

/** A hook as a section uses the two: one resolver identity, and the re-take. */
function useSection(resolvePin: ResolvePin | undefined, retake: () => void) {
  const sendPin = useSendTimePin(resolvePin);
  useRetakeOnceWhenPinned(sendPin, retake);
}

/** A section whose resolver answers `current.pin` when asked. */
function mountSection(
  current: { pin: ProjectPin | undefined },
  options: { wrapper?: (props: { children: ReactNode }) => ReactNode } = {}
) {
  const retake = vi.fn();
  const rendered = renderHook(
    () => useSection(() => current.pin, retake),
    options
  );
  return { retake, ...rendered };
}

const strict = ({ children }: { children: ReactNode }) =>
  createElement(StrictMode, null, children);

describe("useRetakeOnceWhenPinned", () => {
  it("re-takes nothing when the pin was there at the first commit", () => {
    const current = { pin: { tenant: "t-b" } as ProjectPin | undefined };
    const { retake, rerender } = mountSection(current);

    rerender();
    current.pin = { tenant: "t-c" };
    rerender();

    expect(retake).not.toHaveBeenCalled();
  });

  it("re-takes once when the pin first appears after the first commit, and never again", () => {
    const current = { pin: undefined as ProjectPin | undefined };
    const { retake, rerender } = mountSection(current);
    rerender();
    expect(retake).not.toHaveBeenCalled();

    current.pin = { tenant: "t-b" };
    rerender();
    expect(retake).toHaveBeenCalledTimes(1);

    rerender();
    current.pin = { tenant: "t-c" };
    rerender();
    current.pin = undefined;
    rerender();
    current.pin = { tenant: "t-b" };
    rerender();
    expect(retake).toHaveBeenCalledTimes(1);
  });

  it("re-takes nothing while no pin appears", () => {
    const current = { pin: undefined as ProjectPin | undefined };
    const { retake, rerender } = mountSection(current);

    rerender();
    rerender();

    expect(retake).not.toHaveBeenCalled();
  });

  it("re-takes once under StrictMode's double effects, and not at all when pinned at mount", () => {
    const unpinned = { pin: undefined as ProjectPin | undefined };
    const late = mountSection(unpinned, { wrapper: strict });
    expect(late.retake).not.toHaveBeenCalled();
    unpinned.pin = { tenant: "t-b" };
    late.rerender();
    late.rerender();
    expect(late.retake).toHaveBeenCalledTimes(1);

    const pinned = { pin: { tenant: "t-b" } as ProjectPin | undefined };
    const early = mountSection(pinned, { wrapper: strict });
    early.rerender();
    expect(early.retake).not.toHaveBeenCalled();
  });

  it("re-takes once a resolver that arrives after the first commit names a project", () => {
    // No resolver at the first commit: the mount reads went out with no pin.
    const retake = vi.fn();
    let resolvePin: ResolvePin | undefined = undefined;
    const { rerender } = renderHook(() => useSection(resolvePin, retake));
    rerender();
    expect(retake).not.toHaveBeenCalled();

    resolvePin = () => undefined;
    rerender();
    expect(retake).not.toHaveBeenCalled();

    resolvePin = () => ({ tenant: "t-b" });
    rerender();
    expect(retake).toHaveBeenCalledTimes(1);
  });

  it("re-takes nothing for a hook unmounted before the pin appeared", () => {
    const current = { pin: undefined as ProjectPin | undefined };
    const { retake, unmount } = mountSection(current);
    unmount();

    current.pin = { tenant: "t-b" };
    // A new mount is a new hook: it notes its own first commit, pinned.
    const again = mountSection(current);
    again.rerender();

    expect(retake).not.toHaveBeenCalled();
    expect(again.retake).not.toHaveBeenCalled();
  });
});

describe("readPinAtSend", () => {
  const KEY = "qontinui.active_tenant_id";
  afterEach(() => localStorage.removeItem(KEY));

  it("is the page's pin when there is one, whatever is stored", () => {
    localStorage.setItem(KEY, "t-other");
    expect(readPinAtSend({ tenant: "t-b" })).toEqual({ tenant: "t-b" });
  });

  it("is the project stored as the read is sent, without a page pin", () => {
    localStorage.setItem(KEY, "t-stored");
    expect(readPinAtSend(undefined)).toEqual({ tenant: "t-stored" });
  });

  it("is a pin to no project when nothing is stored", () => {
    localStorage.removeItem(KEY);
    expect(readPinAtSend(undefined)).toEqual({ tenant: null });
  });
});
