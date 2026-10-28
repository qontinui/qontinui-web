/**
 * The caption registry's own contract (plan
 * `2026-10-23-console-presentation-spaces` D5): one file per lens surface,
 * composed by one index; every entry filed under its own surface's prefix;
 * every surface with its page caption; copy that an external evaluator can
 * read; and product terms only through the glossary.
 *
 * The composition is self-enforcing: a caption file added beside these that
 * the index does not compose fails here, so a phase cannot ship captions that
 * no `<Caption>` can reach.
 */

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  GLOSSARY_TERMS,
  isGlossaryTerm,
} from "@qontinui/shared-types/glossary";
import {
  CAPTIONS,
  CAPTION_SURFACES,
  captionEntry,
  captionPlainText,
  captionSegments,
  copy,
  isCaptionKey,
  term,
  type CaptionEntry,
  type CaptionText,
} from "./index";

const SURFACES = Object.entries(CAPTION_SURFACES) as Array<
  [string, Record<string, CaptionEntry>]
>;

function plainText(text: CaptionText): string {
  return captionSegments(text)
    .map((s) => (typeof s === "string" ? s : (s.text ?? s.term)))
    .join("");
}

function fields(entry: CaptionEntry): Array<[string, CaptionText]> {
  return [
    ["title", entry.title],
    ["oneLiner", entry.oneLiner],
    ["whyItMatters", entry.whyItMatters],
  ];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A glossary term's name as a whole word in plain copy, singular or plural
 * — captions name product terms in the plural as often as not ("gates",
 * "work units", "policies"). The plural is the last word's.
 */
function termPattern(name: string): RegExp {
  const words = name.toLowerCase().trim().split(/\s+/).map(escapeRegExp);
  const last = words.pop() ?? "";
  const lastForms = /[^aeiou]y$/.test(last)
    ? `${last.slice(0, -1)}(?:y|ies)`
    : `${last}(?:s|es)?`;
  return new RegExp(`\\b${[...words, lastForms].join("\\s+")}\\b`, "i");
}

/**
 * A word used in ANOTHER sense than the glossary's is allowed only by name
 * here, keyed `<caption key>.<field>:<term id>`, with why — never by default.
 */
const ALLOWED_PLAIN: Readonly<Record<string, string>> = {};

/**
 * Every glossary term left as plain text in `entries`' copy, as
 * `<key>.<field>:<term id> — "<segment>"`. A title is a name, not copy, so
 * it may name a term plainly. A plain term renders with no definition to
 * open (D5).
 */
function plainTermOffenders(
  entries: ReadonlyArray<readonly [string, CaptionEntry]>
): string[] {
  const patterns = GLOSSARY_TERMS.map(
    (id) => [id, termPattern(GLOSSARY[id].term)] as const
  );
  const offenders: string[] = [];
  for (const [key, entry] of entries) {
    for (const [name, text] of fields(entry)) {
      if (name === "title") continue;
      for (const segment of captionSegments(text)) {
        if (typeof segment !== "string") continue;
        for (const [id, pattern] of patterns) {
          if (!pattern.test(segment)) continue;
          const at = `${key}.${name}:${id}`;
          if (!(at in ALLOWED_PLAIN)) {
            offenders.push(`${at} — "${segment.trim()}"`);
          }
        }
      }
    }
  }
  return offenders;
}

describe("the caption registry is composed of one file per surface", () => {
  it("composes every caption module in this folder", () => {
    // Each `*Captions.ts` beside the index is one surface's file. The
    // registry's own count must match the folder's, so a new file that the
    // index forgot is a failure here rather than dead copy.
    const files = readdirSync(__dirname).filter((f) =>
      /^[a-zA-Z]+Captions\.ts$/.test(f)
    );
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toHaveLength(SURFACES.length);
  });

  it("covers the five lens surfaces and the tour", () => {
    expect(Object.keys(CAPTION_SURFACES).sort()).toEqual(
      [
        "agentic-activity",
        "coordination-overview",
        "dev-ops",
        "digital-twin",
        "tour",
        "ui-bridge",
      ].sort()
    );
  });

  it("files every entry under its own surface's prefix, with a page caption", () => {
    for (const [surface, entries] of SURFACES) {
      expect(Object.keys(entries), surface).toContain(`${surface}.page`);
      for (const key of Object.keys(entries)) {
        expect(key.startsWith(`${surface}.`), `${surface}: ${key}`).toBe(true);
      }
    }
  });

  it("loses no entry when the surfaces are merged", () => {
    const total = SURFACES.reduce((n, [, e]) => n + Object.keys(e).length, 0);
    expect(Object.keys(CAPTIONS)).toHaveLength(total);
    for (const [, entries] of SURFACES) {
      for (const [key, entry] of Object.entries(entries)) {
        expect(isCaptionKey(key)).toBe(true);
        expect(captionEntry(key as keyof typeof CAPTIONS)).toBe(entry);
      }
    }
    expect(isCaptionKey("dev-ops.no-such-panel")).toBe(false);
    expect(isCaptionKey("toString")).toBe(false);
  });
});

describe("caption copy is written for an external evaluator", () => {
  const entries = Object.entries(CAPTIONS) as Array<[string, CaptionEntry]>;

  it("has a title, a one-liner and why it matters on every entry", () => {
    for (const [key, entry] of entries) {
      for (const [name, text] of fields(entry)) {
        expect(plainText(text).trim().length, `${key}.${name}`).toBeGreaterThan(
          0
        );
      }
    }
  });

  it("keeps every one-liner to ONE sentence", () => {
    for (const [key, entry] of entries) {
      const text = plainText(entry.oneLiner).trim();
      expect(/[.!?]$/.test(text), `${key}: ends a sentence`).toBe(true);
      // A sentence boundary inside it — ". " followed by a capital.
      expect(/[.!?]\s+[A-Z]/.test(text), `${key}: "${text}"`).toBe(false);
    }
  });

  it("carries no internal identifiers — product terms go through the glossary", () => {
    for (const [key, entry] of entries) {
      for (const [name, text] of fields(entry)) {
        for (const segment of captionSegments(text)) {
          if (typeof segment !== "string") continue;
          // snake_case ids, code spans and sub-space symbols are the
          // engineering vocabulary R8 keeps off a primary surface.
          expect(segment, `${key}.${name}`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
          expect(segment, `${key}.${name}`).not.toMatch(/[`Ξ]/);
        }
      }
    }
  });

  it("writes every product term through the glossary, never as plain text", () => {
    expect(plainTermOffenders(entries)).toEqual([]);
  });

  describe("the plain-term check itself can fail", () => {
    const entry = (oneLiner: CaptionText, title = "A page"): CaptionEntry => ({
      title,
      oneLiner,
      whyItMatters: "Nothing more.",
    });

    it.each<[string, CaptionEntry, string]>([
      [
        "a term's name left plain",
        entry("Every stop is the operator's own working page."),
        "x.page.oneLiner:operator",
      ],
      [
        "a plural left plain",
        entry("It keeps their claims, work units and gates consistent."),
        "x.page.oneLiner:claim",
      ],
      [
        "a multi-word plural left plain",
        entry("It keeps their claims, work units and gates consistent."),
        "x.page.oneLiner:work_unit",
      ],
      [
        "a -y plural left plain",
        entry("Every tenant writes its own policies."),
        "x.page.oneLiner:policy",
      ],
    ])("catches %s", (_name, fixture, offender) => {
      expect(
        plainTermOffenders([["x.page", fixture]]).map((o) => o.split(" — ")[0])
      ).toContain(offender);
    });

    it("passes the same words through the glossary, and a title that names one", () => {
      const fixture = entry(
        copy`It keeps their ${term("claim", "claims")}, ${term("work_unit", "work units")} and ${term("gate", "gates")} consistent.`,
        "Gates and claims"
      );
      expect(plainTermOffenders([["x.page", fixture]])).toEqual([]);
    });

    it("does not read a longer word as a term's plural", () => {
      expect(
        plainTermOffenders([["x.page", entry("Gateways are not gates.")]])
      ).toEqual(['x.page.oneLiner:gate — "Gateways are not gates."']);
    });
  });

  it("names only terms the generated glossary defines", () => {
    for (const [key, entry] of entries) {
      for (const [, text] of fields(entry)) {
        for (const segment of captionSegments(text)) {
          if (typeof segment === "string") continue;
          expect(isGlossaryTerm(segment.term), `${key}: ${segment.term}`).toBe(
            true
          );
        }
      }
    }
  });
});

describe("copy / term", () => {
  it("interleaves literal text and terms, dropping empty runs", () => {
    expect(copy`${term("gate", "gates")} wait`).toEqual([
      { term: "gate", text: "gates" },
      " wait",
    ]);
    expect(copy`Every ${term("plan")}.`).toEqual([
      "Every ",
      { term: "plan" },
      ".",
    ]);
  });

  it("reads a plain string as one segment", () => {
    expect(captionSegments("Plain.")).toEqual(["Plain."]);
  });

  it("flattens copy to plain text for an attribute, a term as its words or else the glossary's name", () => {
    expect(
      captionPlainText(copy`Every ${term("gate", "gates")} and ${term("plan")}.`)
    ).toBe(`Every gates and ${GLOSSARY.plan.term}.`);
    expect(captionPlainText("Plain.")).toBe("Plain.");
  });
});
