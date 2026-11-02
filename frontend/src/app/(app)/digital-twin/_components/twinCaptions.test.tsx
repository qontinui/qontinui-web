/**
 * The Twin map's captions as an evaluator reads them (plan
 * `2026-10-23-console-presentation-spaces` D5, style guide §6.5): each
 * sentence is a claim about the product, checked against the code, and its
 * glossary terms read as words of the sentence — "a plan's status", never
 * the glossary's display name "Plan" mid-sentence.
 *
 * The aspect-detail one-liner is rendered above every drill-down. It must not
 * promise every plan with its live status: while presenting the list shows
 * at most eight unfinished plans and counts the rest, and counts the
 * finished ones without listing them (`TwinPlanList`).
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Caption,
  FixedPresentationMode,
  type CaptionKey,
} from "@/components/presentation";

function sentences(id: CaptionKey): { oneLiner: string; why: string } {
  const { container } = render(
    <FixedPresentationMode presenting>
      <Caption id={id} level={3} />
    </FixedPresentationMode>
  );
  const part = (name: string) =>
    container.querySelector(`[data-caption-part="${name}"]`)?.textContent ?? "";
  return { oneLiner: part("one-liner"), why: part("why-it-matters") };
}

describe("the Twin map's captions", () => {
  it("promise the drill-down's plans as the list shows them — not every plan", () => {
    const { oneLiner } = sentences("digital-twin.aspect-detail");
    expect(oneLiner).toBe(
      "The parts of the factory this twin observes, and the plans tied to them, unfinished ones first, with their live status."
    );
  });

  it("read a plan as a word of the sentence, not the glossary's display name", () => {
    expect(sentences("digital-twin.aspect-detail").why).toBe(
      "Each plan's status is read from its work unit, which records its pull requests and status history."
    );
    expect(sentences("digital-twin.twin-map").why).toContain(
      "and a plan's status is read from the work unit that tracks it,"
    );
  });
});
