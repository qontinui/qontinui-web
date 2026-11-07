/**
 * StatusBadge renders every status word as text: `unknown`, and any word the
 * page does not recognise, on the neutral treatment, never in a pass or fail
 * style and never by throwing; and a run's unknown reason as the sentence its
 * cause or code maps to, or as the bare word when it maps to none (plan
 * `2026-11-06-a-regression-test-run-is-judged-by-what-it-covered-and-a-silent-run-reads-unknown`
 * Phase 1).
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { StatusBadge } from "./StatusBadge";

/** Render one badge and return its element. */
function badge(ui: ReactElement): HTMLElement {
  const { container } = render(ui);
  const el = container.querySelector<HTMLElement>('[data-slot="badge"]');
  if (!el) throw new Error("no badge rendered");
  return el;
}

/**
 * The classes that paint a pass or a fail: the success and destructive
 * variants' fill and text. Every badge also carries `aria-invalid:` modifiers
 * naming `destructive`, so a bare substring test would match them all.
 */
function passOrFailClasses(el: HTMLElement): string[] {
  return Array.from(el.classList).filter((c) =>
    /^(bg|text|border)-(success|destructive)(\/|$)/.test(c)
  );
}

const SECRETS_SENTENCE =
  "No runner can type this group's credentials yet. Update a runner to a " +
  "build that substitutes secrets.";

describe("StatusBadge status words", () => {
  it.each([
    { status: "unknown", text: "Unknown", neutral: true },
    { status: "error", text: "Error", neutral: false },
    { status: "partial", text: "partial", neutral: true },
    { status: "PASS", text: "PASS", neutral: true },
  ])(
    "renders $status as the text $text, with no success or destructive class",
    ({ status, text, neutral }) => {
      const el = badge(<StatusBadge status={status} />);
      expect(el.textContent).toBe(text);
      expect(passOrFailClasses(el)).toEqual([]);
      expect(el.classList.contains("text-muted-foreground")).toBe(neutral);
    }
  );

  it("keeps the success style for pass and the destructive style for fail", () => {
    // The control for the empty lists above: the detector does find a style.
    expect(passOrFailClasses(badge(<StatusBadge status="pass" />))).toContain(
      "bg-success"
    );
    expect(passOrFailClasses(badge(<StatusBadge status="fail" />))).toContain(
      "bg-destructive"
    );
  });
});

describe("StatusBadge reason sentences", () => {
  it("renders the cause no_secret_capable_runner's sentence in place of its code's", () => {
    const codeOnly = badge(
      <StatusBadge status="unknown" reason="capability_unavailable_in_build" />
    );
    const withCause = badge(
      <StatusBadge
        status="unknown"
        reason="capability_unavailable_in_build"
        detail="no_secret_capable_runner"
      />
    );
    const codeSentence = (codeOnly.textContent ?? "").replace(
      /^Unknown — /,
      ""
    );
    expect(codeSentence).toMatch(/^No runner paired to this project/);
    expect(withCause.textContent).toBe(`Unknown — ${SECRETS_SENTENCE}`);
    expect(withCause.textContent).not.toContain(codeSentence);
  });

  it("renders a code with no cause as the code's sentence", () => {
    expect(
      badge(<StatusBadge status="unknown" reason="not_reported" />).textContent
    ).toBe(
      "Unknown — Some conditions got no verdict from the check agent. " +
        "Expand the run to see which, then run the group again."
    );
  });

  it.each([
    { reason: "no_such_code", detail: null, text: "no_such_code" },
    { reason: null, detail: "no_such_cause", text: "no_such_cause" },
    {
      reason: "no_such_code",
      detail: "no_such_cause",
      text: "no_such_code (no_such_cause)",
    },
  ])(
    "renders an unrecognised code or cause as itself ($reason, $detail)",
    ({ reason, detail, text }) => {
      expect(
        badge(<StatusBadge status="unknown" reason={reason} detail={detail} />)
          .textContent
      ).toBe(`Unknown — ${text}`);
    }
  );

  it("renders an unrecognised cause as itself after its code's sentence", () => {
    expect(
      badge(
        <StatusBadge
          status="unknown"
          reason="producer_not_run"
          detail="no_such_cause"
        />
      ).textContent
    ).toBe(
      "Unknown — The check never ran. Check that a runner paired to this " +
        "project is online and accepting work, then run the group again. " +
        "(no_such_cause)"
    );
  });

  it("names the runner's own reason inside the runner_refused sentence", () => {
    expect(
      badge(
        <StatusBadge
          status="unknown"
          reason="producer_not_run"
          detail="runner_refused:deferred_by_drain"
        />
      ).textContent
    ).toBe(
      "Unknown — The runner refused the check (deferred_by_drain), so " +
        "nothing was checked. Run the group again once that runner accepts " +
        "work, or pair another runner to this project."
    );
  });

  it("gives an error run its spawn_failed sentence, still in no fail style", () => {
    const el = badge(
      <StatusBadge
        status="error"
        reason="producer_failed"
        detail="spawn_failed"
      />
    );
    expect(el.textContent).toBe(
      "Error — The runner could not start the check agent, so nothing was " +
        "checked. Check that the runner is running and up to date, then run " +
        "the group again."
    );
    expect(passOrFailClasses(el)).toEqual([]);
  });

  // Every cause and code this plan writes reads as a sentence, never as the
  // bare word: a missing entry would render the word itself and fail here.
  it.each([
    { word: "no_report_within_deadline", code: "no_event_before_timeout" },
    { word: "publish_refused", code: "producer_not_run" },
    { word: "runner_refused", code: "producer_not_run" },
    { word: "spawn_failed", code: "producer_failed" },
    { word: "legacy_status", code: "model_reply_unparseable" },
    {
      word: "no_secret_capable_runner",
      code: "capability_unavailable_in_build",
    },
    { word: "not_reported", code: null },
    { word: "no_results", code: null },
    { word: "no_expectation", code: null },
    { word: "no_event_before_timeout", code: null },
    { word: "producer_not_run", code: null },
    { word: "producer_failed", code: null },
    { word: "model_reply_unparseable", code: null },
    { word: "capability_unavailable_in_build", code: null },
  ])("renders $word as a sentence, not the bare word", ({ word, code }) => {
    // A cause rides beside its code; `runner_refused` carries the runner's
    // reason after a colon.
    const el = code
      ? badge(
          <StatusBadge
            status="unknown"
            reason={code}
            detail={word === "runner_refused" ? `${word}:deferred` : word}
          />
        )
      : badge(<StatusBadge status="unknown" reason={word} />);
    const text = el.textContent ?? "";
    expect(text).toMatch(/^Unknown — [A-Z].*\.$/);
    expect(text).not.toContain(word);
  });
});
