/**
 * The slug mirror, pinned by the shared fixture table rather than by eyeball.
 *
 * Plan `2026-08-27-tenant-creation-fix-and-members-page-ux` Phase 1 #7 states
 * the requirement this file exists to meet: a JS mirror of coord's slug rule
 * "must be pinned by a shared fixture table, not by eyeball". So the cases are
 * NOT written here — they are read from `projectSlug.fixtures.json`, every one
 * transcribed from coord's own `slugify_rejects_rather_than_mangles`.
 *
 * Writing the cases inline would have been the easy thing and would have
 * pinned nothing: the failure mode is the mirror drifting from the Rust, and a
 * table maintained beside the mirror drifts with it.
 */

import { describe, expect, it } from "vitest";
import fixtures from "./projectSlug.fixtures.json";
import {
  MAX_DISPLAY_NAME_CHARS,
  MAX_SLUG_LEN,
  MIN_SLUG_LEN,
  projectSlugProblemMessage,
  slugifyProjectName,
  type ProjectSlugReason,
} from "./projectSlug";

/**
 * Expand the `repeat:<char>:<count>` form the fixture uses for the long cases.
 *
 * A 400-character JSON string literal is unreadable, and an unreadable fixture
 * is one nobody re-checks against the Rust — which is the whole point of it.
 */
function expand(input: string): string {
  const match = /^repeat:(.):(\d+)$/.exec(input);
  return match ? match[1].repeat(Number(match[2])) : input;
}

describe("slugifyProjectName — coord's accepted names", () => {
  for (const testCase of fixtures.accepts) {
    it(`${JSON.stringify(testCase.input)} → ${testCase.slug}`, () => {
      expect(slugifyProjectName(expand(testCase.input))).toEqual({
        ok: true,
        slug: testCase.slug,
      });
    });
  }
});

describe("slugifyProjectName — coord's rejections", () => {
  for (const testCase of fixtures.rejects) {
    it(`${JSON.stringify(testCase.input)} → ${testCase.reason}`, () => {
      expect(slugifyProjectName(expand(testCase.input))).toEqual({
        ok: false,
        reason: testCase.reason,
      });
    });
  }
});

describe("the fixture table itself", () => {
  // The fixture records the constants it was written against. If coord moves
  // one and the mirror is updated without the table, or vice versa, these
  // disagree — which is cheaper to read than a wall of failing boundary cases.
  it("agrees with the mirror about coord's constants", () => {
    expect(fixtures.source.constants).toEqual({
      MIN_SLUG_LEN,
      MAX_SLUG_LEN,
      MAX_DISPLAY_NAME_CHARS,
    });
  });

  it("covers every reason the mirror can return", () => {
    // `must_start_with_letter_or_digit` is deliberately absent: the strip step
    // makes it unreachable, in coord as here. Naming it explicitly stops this
    // assertion from being quietly satisfied by a mirror that stopped
    // returning one of the reachable ones.
    const covered = new Set(fixtures.rejects.map((c) => c.reason));
    expect([...covered].sort()).toEqual([
      "display_name_too_long",
      "empty",
      "no_slug_characters",
      "too_long",
      "too_short",
    ]);
  });
});

describe("the property coord asserts: clean or refused, never mangled", () => {
  // coord's own test closes with this loop. Re-running it over the full table
  // is what catches a mirror that returns a slug at all — a leading `-`, a
  // doubled `-`, an over-length id — rather than only one that returns the
  // wrong slug for a case somebody thought to write down.
  const probes = [
    ...fixtures.accepts.map((c) => c.input),
    ...fixtures.rejects.map((c) => c.input),
  ].map(expand);

  for (const probe of probes) {
    it(`${JSON.stringify(probe.slice(0, 32))} yields a clean slug or nothing`, () => {
      const result = slugifyProjectName(probe);
      if (!result.ok) return;
      expect(result.slug).not.toBe("");
      expect(result.slug.startsWith("-")).toBe(false);
      expect(result.slug.endsWith("-")).toBe(false);
      expect(result.slug).not.toContain("--");
      expect(result.slug.length).toBeGreaterThanOrEqual(MIN_SLUG_LEN);
      expect(result.slug.length).toBeLessThanOrEqual(MAX_SLUG_LEN);
      expect(/^[a-z0-9][a-z0-9-]*$/.test(result.slug)).toBe(true);
    });
  }
});

describe("projectSlugProblemMessage", () => {
  it("says nothing about an untouched field", () => {
    // `empty` is what a blank input derives, and a blank input is not yet a
    // mistake — the submit button is already disabled there.
    expect(projectSlugProblemMessage("empty")).toBeNull();
  });

  it("never prints the rule at the user", () => {
    // The members page's slug field prints `Must match ^[a-z0-9][a-z0-9-]{0,63}$`,
    // and this plan names that as the treatment NOT to copy. Asserting the
    // absence is what stops "shows a message" from passing on a pasted regex.
    const reasons: ProjectSlugReason[] = [
      "display_name_too_long",
      "no_slug_characters",
      "too_short",
      "too_long",
      "must_start_with_letter_or_digit",
    ];
    for (const reason of reasons) {
      const message = projectSlugProblemMessage(reason);
      expect(message).toBeTruthy();
      expect(message).not.toContain("[a-z0-9]");
      expect(message).not.toContain("^");
      expect(message).not.toContain("\\p{");
    }
  });
});
