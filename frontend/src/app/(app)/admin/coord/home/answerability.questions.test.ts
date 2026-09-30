/**
 * The answerability fixture — plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 5. The binary test for the human-operator metric *one-screen
 * answerability* is run by an independent session against the rendered page;
 * this file pins the fixture it runs FROM, so the test cannot drift from the
 * page it measures:
 *
 * - exactly the plan's ten questions, in order, verbatim;
 * - each names the door block that answers it and a page region that exists;
 * - each says what counts as an answer, and admits "not measured / unknown"
 *   ONLY conditioned on that block's door state not being `read`.
 */

import { describe, expect, it } from "vitest";
import fixture from "./answerability.questions.json";

const PLAN_QUESTIONS = [
  "Does anything need me right now, and how many things?",
  "For the oldest item that needs me: what is the fork, what is recommended, what changes if I overturn it?",
  "Is any infrastructure degrading, and since when?",
  "Is that degradation being auto-remediated or waiting on someone?",
  "How much of what the fleet says it verified survived independent checking?",
  "Per repo: how much is shipped, in flight, stalled?",
  "Which named pieces of work are stalled, and for how long?",
  "What is the current initiative, when does it end, and how much in-flight work is attributed to it?",
  "Which of the above can this page NOT currently tell me, and as of when was each source last read?",
  "Is the merge train moving?",
];

/** Block → the region of `/admin/coord/home` that renders it. */
const REGION_OF_BLOCK: Record<string, string> = {
  needs_me: "coord-home.needs-you",
  degradations: "coord-home.degrading",
  correctness: "coord-home.correct",
  on_track: "coord-home.on-track",
  does_not_know: "coord-home.does-not-know",
};

interface Question {
  id: string;
  text: string;
  block: string;
  region: string;
  door_fields: string[];
  answer: string;
  unknown_is_an_answer_only_when: string;
}

const questions = fixture.questions as Question[];

describe("answerability.questions.json", () => {
  it("names its plan and its pass rule", () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.plan).toBe(
      "2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen"
    );
    expect(fixture.pass_rule).toMatch(/10 of 10/);
    expect(fixture.pass_rule).toMatch(
      /ONLY for a question whose block's door state is genuinely not 'read'/
    );
  });

  it("carries exactly the plan's ten questions, in order, verbatim", () => {
    expect(questions.map((q) => q.text)).toEqual(PLAN_QUESTIONS);
    expect(questions.map((q) => q.id)).toEqual(
      PLAN_QUESTIONS.map((_, i) => `q${i + 1}`)
    );
  });

  it.each(questions.map((q) => [q.id, q] as const))(
    "%s names a real block, its region, door fields and an answer",
    (_id, q) => {
      expect(Object.keys(REGION_OF_BLOCK)).toContain(q.block);
      expect(q.region).toBe(REGION_OF_BLOCK[q.block]);
      expect(q.door_fields.length).toBeGreaterThan(0);
      for (const f of q.door_fields) {
        expect(f.startsWith(q.block)).toBe(true);
      }
      expect(q.answer.length).toBeGreaterThan(20);
    }
  );

  it.each(questions.map((q) => [q.id, q] as const))(
    "%s admits 'unknown' only conditioned on its own block not being read",
    (_id, q) => {
      const cond = q.unknown_is_an_answer_only_when;
      if (q.block === "does_not_know") {
        expect(cond).toMatch(/does_not_know is absent/);
      } else {
        expect(cond).toContain(`${q.block}.state != "read"`);
      }
    }
  );
});
