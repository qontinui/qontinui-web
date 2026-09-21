/**
 * The width sensor the app shell's three layouts are chosen from.
 *
 * Contracts under test:
 *  - the first render already reports the real width (no post-mount flash);
 *  - a width change re-renders the subscriber;
 *  - unmounting detaches the listener.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMatchMedia, type MatchMediaStub } from "@/test/match-media";
import { useMediaQuery } from "./use-media-query";

let media: MatchMediaStub | null = null;

afterEach(() => {
  media?.restore();
  media = null;
});

describe("useMediaQuery", () => {
  it("reports the real width on the very first render", () => {
    media = installMatchMedia(1440);
    const seen: boolean[] = [];

    function Probe() {
      const wide = useMediaQuery("(min-width: 1024px)");
      seen.push(wide);
      return <span>{String(wide)}</span>;
    }

    render(<Probe />);

    // Not `[false, true]`: a `useState` + effect implementation would flash
    // the default for one render, which is the flash this hook avoids.
    expect(seen[0]).toBe(true);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("re-renders when the query starts matching", () => {
    media = installMatchMedia(390);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => media!.setWidth(820));
    expect(result.current).toBe(true);

    act(() => media!.setWidth(390));
    expect(result.current).toBe(false);
  });

  it("stops listening once unmounted", () => {
    media = installMatchMedia(390);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(media.listenerCount("(min-width: 768px)")).toBe(1);

    unmount();

    // Asserted on the stub, not on `result.current`: `renderHook` freezes
    // that at the last rendered value once unmounted, so it reads the same
    // whether or not the listener was ever detached.
    expect(media.listenerCount("(min-width: 768px)")).toBe(0);
  });

  it("falls back to the declared snapshot when matchMedia is missing", () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    try {
      const { result } = renderHook(() =>
        useMediaQuery("(min-width: 1024px)", false)
      );
      expect(result.current).toBe(false);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: original,
      });
    }
  });
});
