/**
 * `./refusal` is a MIRROR of `Refusal::render()` and the envelope's lenient
 * decoder in `qontinui-schemas/rust/src/refusal.rs`. Every expected sentence
 * here was produced by the Rust side, not written from the TS side:
 *
 * - the named cases are copied from the Rust unit tests in `refusal.rs`
 *   (`render_is_the_table_projection`, `retry_delays_are_humanised_and_capped`,
 *   `targets_are_quoted_as_one_clean_line`, and the decode tests);
 * - `refusal.render-fixtures.json` is the output of qontinui-schemas
 *   `cargo run -q -p qontinui-types --example refusal_render_fixtures`: a dump
 *   of `NextAction::render()` and
 *   `Refusal::render()` over every kind × target × delay shape and every code
 *   × discriminator, run against the Rust crate.
 *
 * A red here means the two sides disagree about what an operator reads.
 */

import { describe, expect, it } from "vitest";

import { GLOSSARY_TERMS } from "@qontinui/shared-types/glossary";
import type {
  NextActionKind,
  RefusalCode,
} from "@qontinui/shared-types/refusal";

import fixtures from "./refusal.render-fixtures.json";
import {
  decodeRefusal,
  quotable,
  renderNextAction,
  renderRefusal,
  RETRY_RENDER_CEILING_S,
  type DecodedNextAction,
} from "./refusal";

const AT = "2026-09-29T00:00:00Z";

function na(
  kind: NextActionKind,
  target: string | null = null,
  retry_after_s: number | null = null
): DecodedNextAction {
  return { kind, target, retry_after_s, unrecognised_kind: null };
}

describe("renderNextAction — the Rust dump", () => {
  it("matches NextAction::render for every dumped shape", () => {
    expect(fixtures.next_action.length).toBeGreaterThan(200);
    for (const row of fixtures.next_action) {
      expect(
        renderNextAction(
          na(row.kind as NextActionKind, row.target, row.retry_after_s)
        ),
        JSON.stringify(row)
      ).toBe(row.render);
    }
  });

  it("covers every kind the generated union declares", () => {
    const kinds = new Set(fixtures.next_action.map((r) => r.kind));
    // The union below is the generated one: a kind added to the schemas and
    // absent from the dump shows up as a missing member here.
    const all: Record<NextActionKind, true> = {
      retry_later: true,
      run_command: true,
      open_page: true,
      sign_in: true,
      pair_device: true,
      set_setting: true,
      wait_for_gate: true,
      none_terminal: true,
      report_defect: true,
      fix_request: true,
      resnapshot: true,
      scroll_into_view: true,
      wait_for_enabled: true,
      broaden_selector: true,
      unrecognised: true,
    };
    expect([...kinds].sort()).toEqual(Object.keys(all).sort());
  });
});

describe("renderRefusal — the Rust dump", () => {
  it("matches Refusal::render for every code × discriminator", () => {
    const codes: Record<RefusalCode, true> = {
      workspace_root_unresolved: true,
      sibling_checkout_absent: true,
      endpoint_unresolved: true,
      glossary_term_unknown: true,
      unknown: true,
    };
    const seen = new Set<string>();
    for (const row of fixtures.refusal) {
      const decoded = decodeRefusal(row.refusal);
      expect(decoded, JSON.stringify(row.refusal)).not.toBeNull();
      expect(renderRefusal(decoded!)).toBe(row.render);
      seen.add(row.refusal.code);
    }
    expect([...seen].sort()).toEqual(Object.keys(codes).sort());
  });
});

describe("render — the Rust unit tests, copied", () => {
  it("render_is_the_table_projection", () => {
    expect(
      renderRefusal({
        code: "workspace_root_unresolved",
        discriminator: null,
        next_action: na("set_setting", "workspace_root"),
      })
    ).toBe(
      'No workspace folder could be found for this operation. Set the "workspace_root" setting, then try again.'
    );
    // NextAction::retry_after_ms(1500) is retry_later with 2 seconds.
    expect(
      renderRefusal({
        code: "endpoint_unresolved",
        discriminator: "backend",
        next_action: na("retry_later", null, 2),
      })
    ).toBe(
      "The address of a service this operation needs is not configured (backend). Try again in 2 seconds."
    );
    const blank = renderRefusal({
      code: "unknown",
      discriminator: " ",
      next_action: na("run_command", "  "),
    });
    expect(blank).not.toContain("()");
    expect(blank).not.toContain('""');
  });

  it("retry_delays_are_humanised_and_capped", () => {
    const r = (s: number) => renderNextAction(na("retry_later", null, s));
    expect(r(0)).toBe("Try again now");
    expect(r(1)).toBe("Try again in 1 second");
    expect(r(119)).toBe("Try again in 119 seconds");
    expect(r(120)).toBe("Try again in 2 minutes");
    expect(r(121)).toBe("Try again in 3 minutes");
    expect(r(7200)).toBe("Try again in 2 hours");
    expect(r(RETRY_RENDER_CEILING_S)).toBe("Try again in 48 hours");
    expect(r(RETRY_RENDER_CEILING_S + 1)).toBe(
      "Try again later; the suggested wait is more than two days"
    );
    expect(r(4_294_967_295)).toBe(r(RETRY_RENDER_CEILING_S + 1));
  });

  it("targets_are_quoted_as_one_clean_line", () => {
    expect(renderNextAction(na("run_command", 'echo "hi"\n  && `rm`\tx'))).toBe(
      "Run the command \"echo 'hi' && `rm` x\""
    );
    const s = renderRefusal({
      code: "unknown",
      discriminator: "a\nb",
      next_action: na("run_command", "x"),
    });
    expect(s).toContain("(a b)");
    expect(s.split("\n")).toHaveLength(1);
  });

  it("quotable keeps U+FEFF, which Rust does not treat as whitespace", () => {
    expect(quotable("a\uFEFFb")).toBe("a\uFEFFb");
    expect(quotable("a\u3000\u0085b")).toBe("a b");
    expect(quotable(" \t ")).toBeNull();
    expect(quotable(null)).toBeNull();
  });

  it("never renders an empty sentence for any shape", () => {
    const codes: RefusalCode[] = [
      "workspace_root_unresolved",
      "sibling_checkout_absent",
      "endpoint_unresolved",
      "glossary_term_unknown",
      "unknown",
    ];
    const kinds = [...new Set(fixtures.next_action.map((r) => r.kind))];
    for (const code of codes) {
      for (const kind of kinds) {
        for (const target of [null, "", "x", 'a\n"b"']) {
          for (const delay of [null, 0, 1, 90, 4_294_967_295]) {
            for (const disc of [null, "", "d"]) {
              const s = renderRefusal({
                code,
                discriminator: disc,
                next_action: na(kind as NextActionKind, target, delay),
              });
              expect(s.trim()).not.toBe("");
              expect(s.endsWith(".")).toBe(true);
              expect(s.split("\n")).toHaveLength(1);
              expect(s.includes("()") || s.includes('""')).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("decodeRefusal — the Rust decode tests, copied", () => {
  it("serde_round_trip_full_and_minimal", () => {
    const full = decodeRefusal({
      code: "endpoint_unresolved",
      discriminator: "backend",
      next_action: { kind: "set_setting", target: "backend_url" },
      glossary_terms: ["device", "tenant"],
      detail: "no value in settings or environment",
      observed_at: AT,
      source: "runner",
    });
    expect(full).toEqual({
      code: "endpoint_unresolved",
      discriminator: "backend",
      next_action: {
        kind: "set_setting",
        target: "backend_url",
        retry_after_s: null,
        unrecognised_kind: null,
      },
      glossary_terms: ["device", "tenant"],
      detail: "no value in settings or environment",
      observed_at: AT,
      source: "runner",
      unrecognised_code: null,
      unrecognised_source: null,
      unrecognised_glossary_terms: [],
    });
    // Absent or null `glossary_terms` decodes as empty.
    for (const terms of [undefined, null]) {
      const r = decodeRefusal({
        code: "unknown",
        next_action: { kind: "none_terminal" },
        observed_at: AT,
        source: "web_backend",
        ...(terms === null ? { glossary_terms: null } : {}),
      });
      expect(r?.glossary_terms).toEqual([]);
    }
  });

  it("next_action_is_required_on_the_wire", () => {
    expect(
      decodeRefusal({ code: "unknown", observed_at: AT, source: "runner" })
    ).toBeNull();
    // The pre-contract `{code, next_action: "<sentence>"}` shape is not an
    // envelope either.
    expect(
      decodeRefusal({
        code: "endpoint_unresolved",
        next_action: "Set BACKEND_URL to the base URL of the backend API.",
        observed_at: AT,
        source: "web_frontend",
      })
    ).toBeNull();
  });

  it("refuses the shapes serde refuses", () => {
    const base = {
      code: "unknown",
      next_action: { kind: "retry_later" },
      glossary_terms: [],
      observed_at: AT,
      source: "coord",
    };
    expect(decodeRefusal(base)).not.toBeNull();
    for (const bad of [
      { ...base, observed_at: undefined },
      { ...base, source: 3 },
      { ...base, code: null },
      { ...base, next_action: { kind: 1 } },
      { ...base, next_action: { kind: "retry_later", retry_after_s: -1 } },
      { ...base, next_action: { kind: "retry_later", retry_after_s: 1.5 } },
      {
        ...base,
        next_action: { kind: "retry_later", retry_after_s: 4_294_967_296 },
      },
      { ...base, next_action: { kind: "open_page", target: 7 } },
      { ...base, glossary_terms: ["gate", 3] },
      { ...base, detail: {} },
    ]) {
      expect(decodeRefusal(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("a_newer_producers_refusal_decodes_with_what_was_unrecognised_recorded", () => {
    const r = decodeRefusal({
      code: "some_code_from_a_newer_producer",
      next_action: { kind: "do_something_new", target: "t", hint: 1 },
      glossary_terms: ["gate", "a_term_from_a_newer_glossary"],
      observed_at: AT,
      source: "a_new_component",
      a_new_field: { x: 1 },
    });
    expect(r).not.toBeNull();
    expect(r!.code).toBe("unknown");
    expect(r!.unrecognised_code).toBe("some_code_from_a_newer_producer");
    expect(r!.next_action.kind).toBe("unrecognised");
    expect(r!.next_action.unrecognised_kind).toBe("do_something_new");
    expect(r!.next_action.target).toBe("t");
    expect(r!.source).toBe("unrecognised");
    expect(r!.unrecognised_source).toBe("a_new_component");
    expect(r!.glossary_terms).toEqual(["gate"]);
    expect(r!.unrecognised_glossary_terms).toEqual([
      "a_term_from_a_newer_glossary",
    ]);
    expect(renderRefusal(r!)).toContain("update the application");
  });

  it("a_relay_is_upgraded_by_a_reader_that_knows_the_raw_values", () => {
    const r = decodeRefusal({
      code: "unknown",
      unrecognised_code: "endpoint_unresolved",
      next_action: {
        kind: "unrecognised",
        unrecognised_kind: "sign_in",
        target: "t",
      },
      glossary_terms: ["gate"],
      unrecognised_glossary_terms: ["tenant", "still_not_a_term"],
      observed_at: AT,
      source: "unrecognised",
      unrecognised_source: "coord",
    });
    expect(r!.code).toBe("endpoint_unresolved");
    expect(r!.unrecognised_code).toBeNull();
    expect(r!.next_action.kind).toBe("sign_in");
    expect(r!.next_action.unrecognised_kind).toBeNull();
    expect(r!.source).toBe("coord");
    expect(r!.unrecognised_source).toBeNull();
    expect(r!.glossary_terms).toEqual(["gate", "tenant"]);
    expect(r!.unrecognised_glossary_terms).toEqual(["still_not_a_term"]);

    const still = decodeRefusal({
      code: "unknown",
      unrecognised_code: "newer_code",
      next_action: { kind: "unrecognised", unrecognised_kind: "newer_kind" },
      glossary_terms: [],
      unrecognised_glossary_terms: null,
      observed_at: AT,
      source: "unrecognised",
      unrecognised_source: "newer_source",
    });
    expect(still!.unrecognised_code).toBe("newer_code");
    expect(still!.next_action.unrecognised_kind).toBe("newer_kind");
    expect(still!.unrecognised_source).toBe("newer_source");
    expect(still!.unrecognised_glossary_terms).toEqual([]);
  });

  it("cause_unknown_is_not_collapsed_into_reader_unknown", () => {
    const r = decodeRefusal({
      code: "unknown",
      next_action: { kind: "report_defect" },
      glossary_terms: [],
      observed_at: AT,
      source: "coord",
    });
    expect(r!.code).toBe("unknown");
    expect(r!.unrecognised_code).toBeNull();
  });

  it("classifies glossary ids against the generated table", () => {
    const r = decodeRefusal({
      code: "unknown",
      next_action: { kind: "none_terminal" },
      glossary_terms: [...GLOSSARY_TERMS],
      observed_at: AT,
      source: "coord",
    });
    expect(r!.glossary_terms).toEqual([...GLOSSARY_TERMS]);
    expect(r!.unrecognised_glossary_terms).toEqual([]);
  });
});
