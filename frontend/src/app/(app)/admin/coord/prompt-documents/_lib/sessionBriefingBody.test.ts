import { describe, it, expect } from "vitest";
import {
  SESSION_BRIEFING_MAX_BYTES,
  sessionBriefingByteLength,
  validateBodyForKind,
  validateSessionBriefingBody,
} from "./sessionBriefingBody";

/**
 * sessionBriefingBody — the client mirror of coord's `session_briefing`
 * write-time content rules.
 *
 * What these pin is FIDELITY, not preference. The value of a client mirror is
 * that it answers in the form what coord would answer with a 400; a mirror that
 * drifts is worse than none, because it either blocks a save coord would accept
 * (the operator cannot proceed and has no recourse) or passes one coord will
 * refuse (the bare 400 is back, now with a form that promised otherwise).
 *
 * So each rule is pinned in BOTH directions — the violating body is refused AND
 * the near-miss that must stay legal is accepted — and the two places where a
 * naive JavaScript port silently diverges from the Rust original get their own
 * cases: the cap is measured in UTF-8 BYTES rather than UTF-16 code units, and
 * the source-marker check reads the first NON-BLANK line case-insensitively.
 */

/** A body that violates nothing — the baseline every case perturbs. */
const CLEAN = [
  "Runner protocol brief.",
  "",
  "Runner HTTP API: {{runner_api_base}}. Coord: {{coord_http_base}}.",
  "Read the playbooks via /coord/agent-prompt-documents.",
].join("\n");

describe("validateSessionBriefingBody — the baseline", () => {
  it("accepts a body that satisfies every rule", () => {
    expect(validateSessionBriefingBody(CLEAN)).toBeNull();
  });

  it("accepts an empty body (emptiness is a separate rule, checked elsewhere)", () => {
    // Coord rejects a blank body in `patch_one` BEFORE calling the content
    // validator, and the dialogs already require a non-empty body. Reporting a
    // content error for "" here would put a second, wrong explanation on the
    // same field.
    expect(validateSessionBriefingBody("")).toBeNull();
  });
});

describe("validateSessionBriefingBody — the size ceiling", () => {
  it("accepts a body exactly at the ceiling", () => {
    expect(validateSessionBriefingBody("a".repeat(SESSION_BRIEFING_MAX_BYTES))).toBeNull();
  });

  it("refuses a body one byte over, and says how far over it is", () => {
    const err = validateSessionBriefingBody("a".repeat(SESSION_BRIEFING_MAX_BYTES + 1));
    // Grouped through `toLocaleString`, so the expectation is computed the same
    // way rather than hard-coding one locale's separator — this suite runs
    // under whatever locale the CI node happens to have.
    expect(err).toContain(`${(SESSION_BRIEFING_MAX_BYTES + 1).toLocaleString()} bytes`);
    expect(err).toContain(SESSION_BRIEFING_MAX_BYTES.toLocaleString());
  });

  /**
   * The divergence a `body.length` check would hide. Coord measures
   * `String::len` — UTF-8 bytes — and this corpus is em-dash-heavy prose, so
   * the two counts differ by a third on exactly the bodies that approach the
   * cap. A character-counting mirror would wave this through and leave coord to
   * refuse it.
   */
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // "—" is 1 UTF-16 code unit and 3 UTF-8 bytes.
    const emDashes = "—".repeat(SESSION_BRIEFING_MAX_BYTES / 3 + 1);
    expect(emDashes.length).toBeLessThan(SESSION_BRIEFING_MAX_BYTES);
    expect(sessionBriefingByteLength(emDashes)).toBeGreaterThan(
      SESSION_BRIEFING_MAX_BYTES
    );
    expect(validateSessionBriefingBody(emDashes)).toContain("bytes");
  });

  it("counts astral characters at their UTF-8 width", () => {
    // An emoji is 2 UTF-16 code units and 4 UTF-8 bytes.
    expect(sessionBriefingByteLength("🚀")).toBe(4);
  });
});

describe("validateSessionBriefingBody — the closed placeholder vocabulary", () => {
  it.each(["runner_api_base", "coord_http_base"])(
    "accepts the known placeholder %s",
    (name) => {
      expect(validateSessionBriefingBody(`Base is {{${name}}}.`)).toBeNull();
    }
  );

  it("accepts a known placeholder written with inner whitespace", () => {
    // Coord trims the token before comparing, so `{{ coord_http_base }}` is the
    // same placeholder. A mirror that did not trim would block a legal body.
    expect(validateSessionBriefingBody("Base is {{ coord_http_base }}.")).toBeNull();
  });

  it("refuses an unknown placeholder and names it", () => {
    const err = validateSessionBriefingBody("Hello {{tenant_slug}}.");
    expect(err).toContain("{{tenant_slug}}");
    expect(err).toContain("Unknown placeholder");
  });

  it("refuses an unterminated placeholder distinctly from an unknown one", () => {
    const err = validateSessionBriefingBody("Hello {{coord_http_base.");
    expect(err).toContain("Unterminated placeholder");
  });

  it("elides a runaway unterminated token instead of quoting the whole body", () => {
    const err = validateSessionBriefingBody(`Start {{${"x".repeat(500)}`);
    expect(err).toContain("…");
    // 64 kept characters plus the ellipsis — nowhere near the 500 that follow.
    expect(err!.length).toBeLessThan(600);
  });

  it("refuses a GitHub Actions expression, which is the realistic way this fires", () => {
    expect(
      validateSessionBriefingBody("Run with ${{ github.event.number }}.")
    ).toContain("Unknown placeholder");
  });

  it("leaves a single brace alone", () => {
    expect(validateSessionBriefingBody("Use {json} objects.")).toBeNull();
  });

  it("checks every placeholder, not only the first", () => {
    expect(
      validateSessionBriefingBody("{{runner_api_base}} then {{nope}}")
    ).toContain("{{nope}}");
  });
});

describe("validateSessionBriefingBody — the forged source marker", () => {
  it("refuses a first line that opens with a source marker", () => {
    expect(
      validateSessionBriefingBody("[source: pkg/runner_context@1.0.0]\nBody.")
    ).toContain("source marker");
  });

  it("refuses it case-insensitively", () => {
    expect(validateSessionBriefingBody("[Source: forged]\nBody.")).toContain(
      "source marker"
    );
  });

  /**
   * The reason coord looks at the first NON-BLANK line: a body opening with a
   * newline would otherwise carry a forged marker on the line a reader actually
   * sees first, while a naive `body.startsWith` saw only the newline.
   */
  it("refuses a marker hidden behind leading blank lines and indentation", () => {
    expect(validateSessionBriefingBody("\n\n   [source: forged]\nBody.")).toContain(
      "source marker"
    );
  });

  it("accepts a source marker that is not the first line", () => {
    expect(
      validateSessionBriefingBody("Briefing.\n\n[source: quoted as an example]")
    ).toBeNull();
  });
});

describe("validateSessionBriefingBody — the operator door", () => {
  it("refuses a body naming the operator door and points at the agent door", () => {
    const err = validateSessionBriefingBody("Edit at /coord/prompt-documents.");
    expect(err).toContain("/coord/prompt-documents");
    expect(err).toContain("/coord/agent-prompt-documents");
  });

  it("accepts the agent door, which does not contain the operator path", () => {
    expect(
      validateSessionBriefingBody("Read /coord/agent-prompt-documents/policy/x.")
    ).toBeNull();
  });
});

describe("validateSessionBriefingBody — the identity scan", () => {
  it("refuses a dashed UUID and quotes it", () => {
    const err = validateSessionBriefingBody(
      "Tenant 9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa is yours."
    );
    expect(err).toContain("9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa");
  });

  it("refuses a dashless 32-hex id", () => {
    expect(
      validateSessionBriefingBody("Device c79a07d57e40c79a07d57e40c79a07d5.")
    ).toContain("UUID-shaped");
  });

  /**
   * The `\b` anchor on the dashless arm, pinned because dropping it is the
   * natural simplification and it would refuse every commit SHA the briefing
   * legitimately quotes.
   */
  it("accepts a 40-hex git SHA, which is not an identity", () => {
    expect(
      validateSessionBriefingBody(
        "Build 218a39e18c26218a39e18c26218a39e18c26abcd is current."
      )
    ).toBeNull();
  });

  it.each([
    "tenant_id",
    "tenantId",
    "TENANT-ID",
    "agent_id",
    "device_id",
    "session_id",
  ])("refuses the identity-shaped key %s", (key) => {
    expect(validateSessionBriefingBody(`Send ${key} in the header.`)).toContain(
      "identity-shaped key"
    );
  });

  it("accepts prose about identity that does not name a key", () => {
    expect(
      validateSessionBriefingBody("Your tenancy comes from the device JWT.")
    ).toBeNull();
  });
});

describe("validateSessionBriefingBody — rule order matches coord's", () => {
  /**
   * An operator fixing one violation at a time must be shown the same one coord
   * would have shown, or the form and the server disagree about what is wrong
   * with the same text.
   */
  it("reports the size ceiling before a placeholder problem", () => {
    const err = validateSessionBriefingBody(
      `{{nope}}${"a".repeat(SESSION_BRIEFING_MAX_BYTES)}`
    );
    expect(err).toContain("bytes");
  });

  it("reports a placeholder problem before the source marker", () => {
    expect(validateSessionBriefingBody("[source: x]\n{{nope}}")).toContain(
      "Unknown placeholder"
    );
  });
});

describe("validateBodyForKind", () => {
  it("applies the rules to session_briefing", () => {
    expect(validateBodyForKind("session_briefing", "{{nope}}")).toContain(
      "Unknown placeholder"
    );
  });

  /**
   * The negative half, and the one that would be a silent regression on five
   * kinds. Coord content-checks `session_briefing` alone; a policy body full of
   * `{{policy:…}}` tokens, tenant ids and operator-door links is ordinary and
   * must stay saveable.
   */
  it.each([
    "policy",
    "response_prompt",
    "continuation_rules",
    "agent_playbook",
    "prompt_template",
  ] as const)("leaves %s unchecked", (kind) => {
    expect(
      validateBodyForKind(
        kind,
        "[source: x]\n{{policy:session-protocol}} tenant_id " +
          "9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa /coord/prompt-documents " +
          "a".repeat(SESSION_BRIEFING_MAX_BYTES)
      )
    ).toBeNull();
  });
});
