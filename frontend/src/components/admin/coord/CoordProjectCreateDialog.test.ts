/**
 * Unit tests for the create-project error surface.
 *
 * Plan `2026-08-25-self-service-tenant-project-creation`, Phase 3. The copy
 * is not what breaks here — the PARSING is. Coord's machine-readable code
 * travels through two envelopes (FastAPI's `{detail: ...}`, and coord's own
 * JSON carried inside it as a STRING because `_proxy_coord_post` forwards
 * `resp.text`), so a naive one-level parse would find no code and flatten
 * every distinct failure into the same generic message.
 */

import { describe, expect, it } from "vitest";
import {
  parseTenantCreateError,
  TenantCreateError,
} from "@/components/sessions/api";
import { projectCreateErrorMessage } from "./CoordProjectCreateDialog";
import fixtures from "./projectSlug.fixtures.json";
import {
  projectSlugProblemMessage,
  slugifyProjectName,
  type ProjectSlugReason,
} from "./projectSlug";

describe("parseTenantCreateError", () => {
  it("unwraps coord's code out of the doubly-wrapped body", () => {
    const body = JSON.stringify({
      detail: '{"error":"slug_taken","slug":"my-pizzeria"}',
    });
    expect(parseTenantCreateError(body)).toEqual({
      code: "slug_taken",
      detail: "slug_taken",
    });
  });

  it("prefers coord's own message over the bare code", () => {
    const body = JSON.stringify({
      detail:
        '{"error":"invalid_name","message":"name has no usable characters"}',
    });
    expect(parseTenantCreateError(body)).toEqual({
      code: "invalid_name",
      detail: "name has no usable characters",
    });
  });

  it("degrades to the raw text when coord answered plain text", () => {
    const body = JSON.stringify({ detail: "coord is not reachable" });
    expect(parseTenantCreateError(body)).toEqual({
      code: null,
      detail: "coord is not reachable",
    });
  });

  it("degrades to the whole body when nothing is JSON at all", () => {
    expect(parseTenantCreateError("<html>502 Bad Gateway</html>")).toEqual(
      {
        code: null,
        detail: "<html>502 Bad Gateway</html>",
      }
    );
  });

  it("survives a FastAPI 422 validation list without inventing a code", () => {
    const body = JSON.stringify({
      detail: [{ loc: ["body", "display_name"], msg: "too short" }],
    });
    const parsed = parseTenantCreateError(body);
    expect(parsed.code).toBeNull();
    expect(parsed.detail).toContain("too short");
  });
});

describe("projectCreateErrorMessage", () => {
  it("names a taken name rather than a generic failure", () => {
    const err = new TenantCreateError(409, "slug_taken", "slug_taken");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name is taken. Pick a different one."
    );
  });

  it("treats a bare 409 as a collision even without a parsed code", () => {
    const err = new TenantCreateError(409, null, "");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name is taken. Pick a different one."
    );
  });

  it("tells the user a name is unusable instead of mangling it", () => {
    const err = new TenantCreateError(400, "invalid_name", "invalid_name");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name can't be used — try letters and numbers."
    );
  });

  it("recognizes the per-operator creation cap", () => {
    const err = new TenantCreateError(403, "tenant_cap_reached", "cap reached");
    expect(projectCreateErrorMessage(err)).toBe(
      "You've reached the limit on how many projects you can create."
    );
    const byStatus = new TenantCreateError(429, null, "too many");
    expect(projectCreateErrorMessage(byStatus)).toBe(
      "You've reached the limit on how many projects you can create."
    );
  });

  it("names every denylist reason coord can answer with", () => {
    // Coord's `reserved_name` reasons (`tenant_self_service::ReservedSlugReason`).
    // The `personal-` one is the security-relevant rejection: both SSO
    // auto-provision paths JOIN an existing slug, so a squatted
    // `personal-<sub>` would capture the tenant a victim's first login
    // lands in.
    expect(
      projectCreateErrorMessage(
        new TenantCreateError(400, "reserved_name", "personal_namespace")
      )
    ).toBe(
      "Names starting with \u201cpersonal\u201d are reserved. Pick a different one."
    );
    expect(
      projectCreateErrorMessage(
        new TenantCreateError(400, "reserved_name", "group_mapped")
      )
    ).toBe("That name is already reserved for a group. Pick a different one.");
    for (const reason of ["configured_default_tenant", "fleet_reserved"]) {
      expect(
        projectCreateErrorMessage(
          new TenantCreateError(400, "reserved_name", reason)
        )
      ).toBe("That name is reserved. Pick a different one.");
    }
  });

  it("keeps an UNKNOWN denylist reason legible instead of flattening it", () => {
    // A reason added coord-side after this ships must still reach the user.
    expect(
      projectCreateErrorMessage(
        new TenantCreateError(400, "reserved_name", "some_future_reason")
      )
    ).toBe("That name is reserved (some_future_reason). Pick a different one.");
  });

  it("recognizes coord's exact cap token, not just the loose match", () => {
    expect(
      projectCreateErrorMessage(
        new TenantCreateError(403, "tenant_cap_reached", "tenant_cap_reached")
      )
    ).toBe("You've reached the limit on how many projects you can create.");
  });

  it("surfaces an unrecognized failure VERBATIM rather than guessing", () => {
    const err = new TenantCreateError(503, "app_unconfigured", "SSO is down");
    expect(projectCreateErrorMessage(err)).toBe(
      "Could not create the project (503): SSO is down"
    );
  });

  it("handles a non-HTTP failure (the fetch itself threw)", () => {
    expect(projectCreateErrorMessage(new Error("NetworkError"))).toBe(
      "NetworkError"
    );
    expect(projectCreateErrorMessage("nope")).toBe(
      "Could not reach the server to create the project."
    );
  });
});

/**
 * The server-side half of the live slug preview.
 *
 * The preview (`projectSlug.ts`) deliberately has **no veto**, so a name it
 * dislikes is still submitted and coord still rejects it — which makes this the
 * live end of the same journey, not a theoretical branch. Coord answers
 * `{"error":"invalid_name","reason":<TenantNameError::reason()>}` and its own
 * docstring calls that reason "the machine-readable discriminator the frontend
 * renders against".
 *
 * These cases are driven off `projectSlug.fixtures.json` — the same table that
 * pins the mirror — so the two surfaces cannot be updated apart: a reason added
 * to the fixture is asserted on both sides here by construction.
 */
describe("projectCreateErrorMessage — coord's `invalid_name` reason", () => {
  /**
   * Build the error the way `createTenant` really does, through BOTH envelopes,
   * rather than hand-constructing `TenantCreateError`. Hand-constructing it
   * would assert the copy while assuming the parse — and the parse is the half
   * that has actually broken before (see the suite above).
   */
  function fromCoord(reason: string): TenantCreateError {
    const wire = JSON.stringify({
      detail: JSON.stringify({ error: "invalid_name", reason }),
    });
    const { code, detail } = parseTenantCreateError(wire);
    return new TenantCreateError(400, code, detail);
  }

  /** The fixture's `repeat:<char>:<count>` form, as in `projectSlug.test.ts`. */
  function expand(input: string): string {
    const match = /^repeat:(.):(\d+)$/.exec(input);
    return match ? match[1].repeat(Number(match[2])) : input;
  }

  for (const testCase of fixtures.rejects) {
    const reason = testCase.reason as ProjectSlugReason;
    if (reason === "empty") continue; // no sentence by design — asserted below
    it(`${JSON.stringify(testCase.input)} reads the same before and after submit`, () => {
      // What the preview says about the name...
      expect(slugifyProjectName(expand(testCase.input))).toEqual({
        ok: false,
        reason,
      });
      const previewSentence = projectSlugProblemMessage(reason);
      expect(previewSentence).toBeTruthy();
      // ...is what the dialog says when coord rejects that same name.
      expect(projectCreateErrorMessage(fromCoord(reason))).toBe(
        previewSentence
      );
    });
  }

  it("stops answering `ab` with advice that is false", () => {
    // The concrete regression: `ab` is already letters, so "try letters and
    // numbers" told the user to do the thing they had just done. Pinned as a
    // literal because the point is the SENTENCE, not that some string changed.
    const message = projectCreateErrorMessage(fromCoord("too_short"));
    expect(message).toBe("A short id needs at least 3 letters or digits.");
    expect(message).not.toContain("letters and numbers");
  });

  it("falls back to the general sentence when NO reason travelled", () => {
    // `parseTenantCreateError` echoes the code as the detail when coord's body
    // carries no message/detail/reason. Inventing a cause there would be worse
    // than answering generally.
    for (const detail of ["invalid_name", ""]) {
      expect(
        projectCreateErrorMessage(
          new TenantCreateError(400, "invalid_name", detail)
        )
      ).toBe("That name can't be used — try letters and numbers.");
    }
  });

  it("falls back for `empty` rather than rendering a blank error box", () => {
    // `projectSlugProblemMessage("empty")` is `null` on purpose. Submit is
    // disabled on an empty name so coord cannot really answer this — but a
    // `null` must never reach the box if it ever does.
    expect(projectSlugProblemMessage("empty")).toBeNull();
    expect(projectCreateErrorMessage(fromCoord("empty"))).toBe(
      "That name can't be used — try letters and numbers."
    );
  });

  it("keeps an UNKNOWN reason legible instead of flattening it", () => {
    // Coord owns the list, so a reason added after this ships is not an error —
    // it must still reach the user, and without the letters-and-numbers advice,
    // which we would then have no basis for.
    const message = projectCreateErrorMessage(fromCoord("contains_emoji"));
    expect(message).toBe("That name can't be used (contains_emoji).");
    expect(message).not.toContain("letters and numbers");
  });

  it("never prints coord's rule at the user", () => {
    // Same guard the preview carries: "shows an error" must not be satisfiable
    // by pasting `^[a-z0-9][a-z0-9-]{0,63}$` at somebody.
    for (const testCase of fixtures.rejects) {
      const message = projectCreateErrorMessage(fromCoord(testCase.reason));
      expect(message).not.toContain("[a-z0-9]");
      expect(message).not.toContain("^");
    }
  });
});
