"use client";

import { useEffect, useRef } from "react";
import { tourKeyDirection, type TourDirection } from "./tourKeys";

/**
 * Moves the tour on ArrowLeft / ArrowRight for as long as the component
 * calling it is mounted — the tour bar, which renders only while the lens is
 * presenting and the tab is on the tour. The listener is added on mount and
 * removed on unmount, so operator mode, and a tab off the tour, carry none.
 *
 * Which presses count is `tourKeyDirection`'s decision. `go` moves the tour
 * and says whether it did — a direction with nowhere to go (the first stop's
 * previous) moves nothing, and that press keeps its default.
 */
export function useTourKeys(go: (direction: TourDirection) => boolean): void {
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = tourKeyDirection(event);
      if (direction !== null && goRef.current(direction)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
