/**
 * The R3 invariant, enforced across EVERY console surface at once.
 *
 * `MergePipeline.test.tsx` and `alertStatus.test.ts` each assert their own
 * palette agrees with their own `ATTENTION_BY_KIND`. Both of those stay — they
 * are each surface's own oracle. What they cannot do is bind a surface that
 * does not exist yet, and 29 more console routes are about to adopt this
 * pattern (plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`).
 *
 * So the invariant is generalised into `paletteDisagreements` and audited here
 * over a REGISTRY. Adding a console surface means adding one row to
 * {@link CONSOLE_PALETTES}; forgetting to is the one failure this file cannot
 * catch, which is why the registry sits next to the primitive rather than
 * inside a page.
 *
 * **That failure had already happened**, which is the best argument for the
 * warning above being load-bearing rather than decorative: Wave 1 shipped three
 * palettes and Wave 2 four, and none of the seven were registered here — each
 * had only its own module-local audit. All seven are registered now. A surface
 * whose palette is audited only beside itself is a surface whose audit can be
 * deleted with it.
 *
 * See `frontend/docs/console-ui-style-guide.md` §4.2 (the
 * `ATTENTION_BY_KIND` audit-table contract).
 */

import { describe, expect, it } from "vitest";

import {
  ATTENTION_RANK,
  attentionOf,
  escalateAttention,
  paletteDisagreements,
  type Attention,
  type AttentionMap,
  type AuditablePalette,
} from "./attention";
import {
  AUTHOR_GLYPH_KINDS,
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  STATUS_BADGE_CLASS,
  WAITING_AMBER,
} from "./statusRow";
import { ATTENTION_BY_KIND as PIPELINE_ATTENTION } from "@/components/operations/prPipeline";
import { ATTENTION_BY_KIND as ALERT_ATTENTION } from "@/components/admin/coord/alertStatus";
import {
  ALERT_AUTHOR_GLYPH_KINDS,
  ALERT_BADGE_CLASS,
  ALERT_PER_ROW_KINDS,
} from "@/components/admin/coord/AlertRow";
// Wave 1 surfaces.
import {
  PLAN_ATTENTION_BY_TONE,
  PLAN_AUTHOR_GLYPH_TONES,
  PLAN_TONE_CLASS,
} from "@/components/admin/coord/planStatus";
import {
  TREE_ATTENTION_BY_KIND,
  TREE_AUTHOR_GLYPH_KINDS,
  TREE_BADGE_CLASS,
} from "@/components/admin/coord/treeStatus";
import {
  QUESTION_ATTENTION_BY_KIND,
  QUESTION_AUTHOR_GLYPH_KINDS,
  QUESTION_BADGE_CLASS,
} from "@/components/admin/coord/questionStatus";
// Wave 2 surfaces.
import {
  MEMORY_ATTENTION_BY_TONE,
  MEMORY_AUTHOR_GLYPH_TONES,
  MEMORY_TONE_CLASS,
} from "@/components/admin/coord/memoryStatus";
import {
  PULL_ATTENTION_BY_VERDICT,
  PULL_AUTHOR_GLYPH_VERDICTS,
  PULL_VERDICT_CLASS,
} from "@/components/admin/coord/pullDecisionStatus";
import {
  RELEASE_ATTENTION_BY_STATE,
  RELEASE_AUTHOR_GLYPH_STATES,
  RELEASE_STATE_CLASS,
} from "@/components/admin/coord/releaseStatus";
import {
  CLEARANCE_ATTENTION_BY_KIND,
  CLEARANCE_AUTHOR_GLYPH_KINDS,
  CLEARANCE_RULE_CLASS,
} from "@/app/(app)/admin/coord/gate-clearance/clearanceRuleStatus";
import {
  PROPOSAL_ATTENTION_BY_KIND,
  PROPOSAL_AUTHOR_GLYPH_KINDS,
  PROPOSAL_KIND_CLASS,
} from "@/app/(app)/admin/coord/prompt-document-proposals/proposalStatus";
import {
  CLAIM_ATTENTION_BY_PHASE,
  CLAIM_AUTHOR_GLYPH_PHASES,
  CLAIM_PHASE_CLASS,
} from "@/components/admin/coord/onboardingClaimStatus";
import {
  VERIFICATION_ATTENTION_BY_KIND,
  VERIFICATION_AUTHOR_GLYPH_KINDS,
  VERIFICATION_CLASS,
} from "@/components/admin/coord/verificationStatus";

/**
 * Every kind→attention table in the console, paired with the palette that
 * renders it. One row per surface.
 */
const CONSOLE_PALETTES: ReadonlyArray<{
  surface: string;
  attentionByKind: AttentionMap<string>;
  palette: AuditablePalette<string>;
  /** Kinds whose badge class is resolved per row — see `paletteDisagreements`. */
  perRowKinds?: ReadonlySet<string>;
}> = [
  {
    surface: "merge pipeline (/admin/coord/pipeline)",
    attentionByKind: PIPELINE_ATTENTION,
    palette: {
      badgeClass: STATUS_BADGE_CLASS,
      authorGlyphKinds: AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "alerts (/admin/coord/alerts)",
    attentionByKind: ALERT_ATTENTION,
    palette: {
      badgeClass: ALERT_BADGE_CLASS,
      authorGlyphKinds: ALERT_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
    // `unknown` is amber-BY-FLOOR in the table but neutral in the static
    // badge: its real attention is severity-derived per row, and
    // `alertPaletteFor` paints the row from that. `alertStatus.test.ts`
    // covers the per-row resolution; this audit covers the static table.
    perRowKinds: ALERT_PER_ROW_KINDS as ReadonlySet<string>,
  },
  // --- Phase 3 Wave 1 -------------------------------------------------------
  {
    surface: "plans (/admin/coord/plans, /history)",
    attentionByKind: PLAN_ATTENTION_BY_TONE,
    palette: {
      badgeClass: PLAN_TONE_CLASS,
      authorGlyphKinds: PLAN_AUTHOR_GLYPH_TONES as ReadonlySet<string>,
    },
  },
  {
    surface: "trees (/admin/coord/trees)",
    attentionByKind: TREE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: TREE_BADGE_CLASS,
      authorGlyphKinds: TREE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "questions (/admin/coord/questions)",
    attentionByKind: QUESTION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: QUESTION_BADGE_CLASS,
      authorGlyphKinds: QUESTION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 2 -------------------------------------------------------
  {
    surface: "memory (/admin/coord/memory)",
    attentionByKind: MEMORY_ATTENTION_BY_TONE,
    palette: {
      badgeClass: MEMORY_TONE_CLASS,
      authorGlyphKinds: MEMORY_AUTHOR_GLYPH_TONES as ReadonlySet<string>,
    },
  },
  {
    surface: "pull decisions (/admin/coord/pull-decisions)",
    attentionByKind: PULL_ATTENTION_BY_VERDICT,
    palette: {
      badgeClass: PULL_VERDICT_CLASS,
      authorGlyphKinds: PULL_AUTHOR_GLYPH_VERDICTS as ReadonlySet<string>,
    },
  },
  {
    surface: "releases (/admin/coord/releases)",
    attentionByKind: RELEASE_ATTENTION_BY_STATE,
    palette: {
      badgeClass: RELEASE_STATE_CLASS,
      authorGlyphKinds: RELEASE_AUTHOR_GLYPH_STATES as ReadonlySet<string>,
    },
  },
  {
    surface: "land + deploy verification (/admin/coord/lands, /deploys)",
    attentionByKind: VERIFICATION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: VERIFICATION_CLASS,
      authorGlyphKinds: VERIFICATION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 3 -------------------------------------------------------
  {
    surface: "onboarding claim (/admin/coord/onboarding-status)",
    attentionByKind: CLAIM_ATTENTION_BY_PHASE,
    palette: {
      badgeClass: CLAIM_PHASE_CLASS,
      authorGlyphKinds: CLAIM_AUTHOR_GLYPH_PHASES as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 5 -------------------------------------------------------
  {
    surface: "policy-edit proposals (/admin/coord/prompt-document-proposals)",
    attentionByKind: PROPOSAL_ATTENTION_BY_KIND,
    palette: {
      badgeClass: PROPOSAL_KIND_CLASS,
      authorGlyphKinds: PROPOSAL_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "gate-clearance rules (/admin/coord/gate-clearance)",
    attentionByKind: CLEARANCE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: CLEARANCE_RULE_CLASS,
      authorGlyphKinds: CLEARANCE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
];

describe("R3 — every console palette agrees with its attention table", () => {
  for (const { surface, attentionByKind, palette, perRowKinds } of CONSOLE_PALETTES) {
    it(`${surface}: red iff author, amber iff waiting, ✕ iff red`, () => {
      expect(
        paletteDisagreements(attentionByKind, palette, { perRowKinds })
      ).toEqual([]);
    });

    it(`${surface}: the attention table is non-empty and total over its palette`, () => {
      const kinds = Object.keys(attentionByKind);
      expect(kinds.length).toBeGreaterThan(0);
      // A palette entry with no attention row is the mirror of the "kind with
      // no badge class" clause: it means a kind renders with a colour but no
      // declared severity, so nothing constrains that colour.
      expect(
        Object.keys(palette.badgeClass).filter((k) => !(k in attentionByKind))
      ).toEqual([]);
    });
  }

  it("catches a palette that paints a calm kind red", () => {
    // The original bug, reproduced: a red badge on a state that needs nobody.
    const attention: AttentionMap<"running"> = { running: "none" };
    const problems = paletteDisagreements(attention, {
      badgeClass: { running: AUTHOR_RED },
      authorGlyphKinds: new Set<"running">(),
    });
    expect(problems).toContain("running: attention=none but badge is red");
  });

  it("catches an author kind with no ✕ glyph", () => {
    const attention: AttentionMap<"broken"> = { broken: "author" };
    const problems = paletteDisagreements(attention, {
      badgeClass: { broken: AUTHOR_RED },
      authorGlyphKinds: new Set<"broken">(),
    });
    expect(problems).toContain("broken: is red but carries no ✕ glyph");
  });

  it("catches a ✕ on a kind nobody must act on", () => {
    const attention: AttentionMap<"waiting"> = { waiting: "waiting" };
    const problems = paletteDisagreements(attention, {
      badgeClass: { waiting: WAITING_AMBER },
      authorGlyphKinds: new Set<"waiting">(["waiting"]),
    });
    expect(problems).toContain(
      "waiting: carries ✕ but is not an author-action kind"
    );
  });

  it("catches a kind the palette forgot", () => {
    const attention: AttentionMap<"a" | "b"> = { a: "none", b: "none" };
    const problems = paletteDisagreements(attention, {
      badgeClass: { a: CI_YELLOW } as Record<"a" | "b", string>,
      authorGlyphKinds: new Set<"a" | "b">(),
    });
    expect(problems).toContain("b: has no badge class");
  });

  it("perRowKinds exempts AMBER only — a red floor is still a bug", () => {
    // The inline carve-out this generalises only ever skipped the amber
    // clause. If the shared audit skipped red too it would be weaker than the
    // check it replaced, and a future surface adopting perRowKinds without
    // its own oracle would ship a red badge on a row nobody must act on.
    const attention: AttentionMap<"unknown"> = { unknown: "waiting" };
    const perRowKinds = new Set(["unknown"]);

    // The legitimate case: an amber-by-floor kind painted neutral. Allowed.
    expect(
      paletteDisagreements(
        attention,
        { badgeClass: { unknown: INERT }, authorGlyphKinds: new Set<"unknown">() },
        { perRowKinds }
      )
    ).toEqual([]);

    // The case the exemption must NOT swallow: the same kind painted red.
    expect(
      paletteDisagreements(
        attention,
        { badgeClass: { unknown: AUTHOR_RED }, authorGlyphKinds: new Set<"unknown">() },
        { perRowKinds }
      )
    ).toContain("unknown: attention=waiting but badge is red");
  });

  it("accepts an inert kind — neither red nor amber", () => {
    const attention: AttentionMap<"idle"> = { idle: "none" };
    expect(
      paletteDisagreements(attention, {
        badgeClass: { idle: INERT },
        authorGlyphKinds: new Set<"idle">(),
      })
    ).toEqual([]);
  });
});

describe("attentionOf", () => {
  const map: AttentionMap<"hot" | "cold"> = { hot: "author", cold: "none" };

  it("returns the declared attention for a known kind", () => {
    expect(attentionOf(map, "hot")).toBe("author");
    expect(attentionOf(map, "cold")).toBe("none");
  });

  it("floors an UNKNOWN kind at waiting, never at none", () => {
    // Absence is UNKNOWN, not "nothing is wrong". Rendering a kind this build
    // has never seen as calm is the silent-empty-is-unknown mistake.
    expect(attentionOf(map, "kind-from-the-future")).toBe("waiting");
  });

  it("lets a surface choose a louder floor, explicitly", () => {
    expect(attentionOf(map, "kind-from-the-future", "author")).toBe("author");
  });
});

describe("escalateAttention", () => {
  const order: Attention[] = ["none", "waiting", "author"];

  it("ranks the vocabulary loudest-last", () => {
    expect(order.map((a) => ATTENTION_RANK[a])).toEqual([0, 1, 2]);
  });

  it("raises a row above its kind's floor", () => {
    expect(escalateAttention("waiting", "author")).toBe("author");
    expect(escalateAttention("none", "waiting")).toBe("waiting");
  });

  it("NEVER lowers one", () => {
    // A kind table encodes what the kind means; per-row evidence may add to
    // that and must not contradict it.
    expect(escalateAttention("author", "none")).toBe("author");
    expect(escalateAttention("waiting", "none")).toBe("waiting");
  });
});
