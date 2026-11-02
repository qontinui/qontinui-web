"use client";

import type { Ref } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { TOUR_LABELS } from "../captions/tourCaptions";
import { TourLink } from "./TourLink";
import type { TourDirection } from "./tourKeys";
import type { TourTarget, TourView } from "./tourModel";

/** The key that moves the tour in each direction (`tourKeys.ts`). */
export const TOUR_SHORTCUT: Record<TourDirection, string> = {
  previous: "ArrowLeft",
  next: "ArrowRight",
};

/** The visible words of a step control, and its accessible name. */
export function stepWords(
  direction: TourDirection,
  target: TourTarget,
  place: TourView["place"]
): { text: string; name: string } {
  if (target.kind === "start") {
    return { text: TOUR_LABELS.backToStart, name: TOUR_LABELS.backToStart };
  }
  if (direction === "previous" && place === "off-route") {
    const back = TOUR_LABELS.backTo(target.title);
    return { text: back, name: back };
  }
  return direction === "previous"
    ? { text: TOUR_LABELS.previous, name: TOUR_LABELS.previousStop(target.title) }
    : { text: TOUR_LABELS.next, name: TOUR_LABELS.nextStop(target.title) };
}

export interface TourStepControlProps {
  direction: TourDirection;
  view: TourView;
  /** Receives the link while there is one, so the arrow key follows it. */
  linkRef: Ref<HTMLAnchorElement>;
}

/**
 * Previous or next on the tour bar (plan
 * `2026-10-23-console-presentation-spaces` D5).
 *
 * With somewhere to go it is a tour link — to the nearest presentable stop
 * that way, back to the tour's start after the last one, or back to where
 * the tour left off from a page off the route — and it declares its arrow
 * key (`aria-keyshortcuts`). With nowhere to go it is a DISABLED button
 * whose accessible name says why ("Previous: this is the first stop"):
 * never a dead link, and no UI Bridge registration, since it does nothing.
 */
export function TourStepControl({
  direction,
  view,
  linkRef,
}: TourStepControlProps) {
  const target = direction === "previous" ? view.previous : view.next;
  const word =
    direction === "previous" ? TOUR_LABELS.previous : TOUR_LABELS.next;
  const icon =
    direction === "previous" ? (
      <ChevronLeft aria-hidden="true" />
    ) : (
      <ChevronRight aria-hidden="true" />
    );
  const testId = `tour-bar-${direction}`;

  if (target === null) {
    const missing =
      (direction === "previous" ? view.previousMissing : view.nextMissing) ??
      "no-presentable-stop";
    const why = TOUR_LABELS.missing(word, missing);
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        aria-label={why}
        title={why}
        data-testid={testId}
      >
        {direction === "previous" && icon}
        {word}
        {direction === "next" && icon}
      </Button>
    );
  }

  const { text, name } = stepWords(direction, target, view.place);
  return (
    <TourLink
      bridgeId={testId}
      bridgeLabel={name}
      href={target.href}
      accessibleName={name === text ? undefined : name}
      aria-keyshortcuts={TOUR_SHORTCUT[direction]}
      linkRef={linkRef}
      className={buttonVariants({ variant: "outline", size: "sm" })}
      data-testid={testId}
    >
      {direction === "previous" && icon}
      {text}
      {direction === "next" && icon}
    </TourLink>
  );
}
