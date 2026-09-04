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
 * {@link CONSOLE_PALETTES}, which is why the registry sits next to the
 * primitive rather than inside a page.
 *
 * **Forgetting that row used to be the one failure this file could not catch,
 * and it had already happened**: Wave 1 shipped three palettes and Wave 2 four,
 * and none of the seven were registered here — each had only its own
 * module-local audit for weeks. A surface whose palette is audited only beside
 * itself is a surface whose audit can be deleted with it.
 *
 * That hole is now closed by the enrolment check further down, which DISCOVERS
 * every attention table on disk and fails on any that no registry row holds —
 * so the registry is derived from the tree rather than from whoever remembered.
 * An audit that depends on being enrolled in is an audit with a hole; this one
 * enrols its own subjects. See "The registry's own hole, closed."
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
// Wave 4 surfaces — Family C, the tables.
import {
  PR_ATTENTION_BY_MERGE_STATUS,
  PR_AUTHOR_GLYPH_STATUSES,
  PR_MERGE_STATUS_CLASS,
} from "@/app/(app)/admin/coord/prs/prStatus";
import {
  GATE_ATTENTION_BY_KIND,
  GATE_AUTHOR_GLYPH_KINDS,
  GATE_KIND_CLASS,
} from "@/app/(app)/admin/coord/gates/gateStatus";
import {
  POLICY_ATTENTION_BY_KIND,
  POLICY_AUTHOR_GLYPH_KINDS,
  POLICY_KIND_CLASS,
} from "@/app/(app)/admin/coord/policies/policyAutonomyStatus";
import {
  GIT_OP_ATTENTION_BY_KIND,
  GIT_OP_AUTHOR_GLYPH_KINDS,
  GIT_OP_KIND_CLASS,
} from "@/app/(app)/admin/coord/git-ops/gitOpStatus";
import {
  FEDERATION_ATTENTION_BY_KIND,
  FEDERATION_AUTHOR_GLYPH_KINDS,
  FEDERATION_KIND_CLASS,
} from "@/app/(app)/admin/coord/federation/federationStatus";
import {
  MEMBER_ATTENTION_BY_KIND,
  MEMBER_AUTHOR_GLYPH_KINDS,
  MEMBER_KIND_CLASS,
} from "@/app/(app)/admin/coord/members/memberStatus";
// The consolidated sessions console — plan
// `2026-08-26-sessions-console-consolidation` Phase 1. Not under
// `admin/coord/`, and the guide's §1 scope clause is explicit that it covers
// "any operator surface added after them" for exactly this case.
import {
  SESSION_ATTENTION_BY_KIND,
  SESSION_AUTHOR_GLYPH_KINDS,
  SESSION_STATUS_CLASS,
  SESSION_WORK_ATTENTION_BY_KIND,
  SESSION_WORK_CLASS,
  SESSION_WORK_PALETTE,
} from "@/components/sessions/sessionConsoleStatus";

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
  // --- Phase 3 Wave 4 — Family C, the tables --------------------------------
  {
    surface: "open PRs (/admin/coord/prs)",
    attentionByKind: PR_ATTENTION_BY_MERGE_STATUS,
    palette: {
      badgeClass: PR_MERGE_STATUS_CLASS,
      authorGlyphKinds: PR_AUTHOR_GLYPH_STATUSES as ReadonlySet<string>,
    },
  },
  {
    surface: "gates (/admin/coord/gates)",
    attentionByKind: GATE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: GATE_KIND_CLASS,
      authorGlyphKinds: GATE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "tenant autonomy (/admin/coord/policies)",
    attentionByKind: POLICY_ATTENTION_BY_KIND,
    palette: {
      badgeClass: POLICY_KIND_CLASS,
      authorGlyphKinds: POLICY_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "git-op feed (/admin/coord/git-ops)",
    attentionByKind: GIT_OP_ATTENTION_BY_KIND,
    palette: {
      badgeClass: GIT_OP_KIND_CLASS,
      authorGlyphKinds: GIT_OP_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "memory federation (/admin/coord/federation)",
    attentionByKind: FEDERATION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: FEDERATION_KIND_CLASS,
      authorGlyphKinds: FEDERATION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "member access (/admin/coord/members)",
    attentionByKind: MEMBER_ATTENTION_BY_KIND,
    palette: {
      badgeClass: MEMBER_KIND_CLASS,
      authorGlyphKinds: MEMBER_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- the consolidated sessions console ------------------------------------
  {
    surface: "sessions (/sessions)",
    attentionByKind: SESSION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: SESSION_STATUS_CLASS,
      authorGlyphKinds: SESSION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // The SECOND axis the same surface paints — `coord.sessions.session_status`,
  // the work axis, whose terminal word is `finished`. A separate row rather
  // than extra members of the one above because liveness and work are
  // orthogonal (a live session can be finished; a closed one can be
  // unfinished) and one badge cannot answer both. Plan
  // `2026-09-01-session-finished-marker-and-unfinished-resume` Phase 4.
  {
    surface: "sessions — work axis (/sessions)",
    attentionByKind: SESSION_WORK_ATTENTION_BY_KIND,
    palette: {
      badgeClass: SESSION_WORK_CLASS,
      authorGlyphKinds:
        SESSION_WORK_PALETTE.authorGlyphKinds as ReadonlySet<string>,
    },
  },
];

// ---------------------------------------------------------------------------
// The registry's own hole, closed.
//
// Everything above audits the surfaces that are IN `CONSOLE_PALETTES`. None of
// it can say anything about a surface that was never added — and this file's
// own header records that exact failure happening: Wave 1 shipped three
// palettes and Wave 2 four, and none of the seven were enrolled here, so each
// was audited only beside itself for weeks. Somebody noticing is not a control.
//
// So enrolment is derived from the tree instead of remembered. Every module
// that declares an attention table is discovered by `import.meta.glob` and
// matched against the registry BY OBJECT IDENTITY — not by name, which would
// just move the hand-maintained list somewhere else.
//
// Both directions are asserted, and the second is the one that keeps this
// honest:
//
//   1. Every DISCOVERED table is registered. This is the hole above.
//   2. Every REGISTERED table is discovered. This guards the guard: move a
//      status module to a path the patterns miss and clause (1) goes quiet
//      while still passing, which is a worse state than not having it. A
//      discovery that silently stops discovering is the `silent-empty-is-
//      unknown` failure applied to a test.
//
// A third clause guards what the first two cannot. Clause (2) only binds a
// table somebody REGISTERED — which is precisely the case where the author did
// the right thing. For the case this file exists for, an UNREGISTERED table,
// anything the discovery fails to see is seen by nothing at all, and passes.
// So every remembered thing in the discovery is a hole in clause (1), and the
// discovery has to have as few of them as possible:
//
//   - The DIRECTORY list was one, and it is gone. The first cut named
//     `admin/coord/` and `app/` explicitly, so the hand-maintained list was
//     relocated rather than removed — and the very next surface (#1142, the
//     sessions console) landed outside both. The component arm is now recursive
//     over the `*Status.ts` convention instead.
//   - The NAME convention is the other, and it cannot go — the shape alone is
//     too loose to discover on. So clause (3) reports the asymmetry rather than
//     skipping it: an export shaped like an attention table but not named like
//     one is named, not ignored.
// ---------------------------------------------------------------------------

/**
 * Where console attention tables live, as Vite-expanded literals.
 *
 * The patterns are shaped around the CONVENTION — a pure `*Status.ts` module
 * beside the surface, plus the merge pipeline's derivation, which predates it —
 * and NOT around the directories those modules happen to sit in today. That
 * distinction is the whole point, and the first cut of this got it wrong: the
 * patterns named `../admin/coord/` and `../../app/` as directories, so a
 * surface filing its table anywhere else was invisible to clause (1). That did
 * not close the hand-maintained list, it MOVED it — out of
 * {@link CONSOLE_PALETTES}, where a reviewer of a new surface reads it, and
 * into a glob line in a test's internals, where nobody thinks to look. Both
 * spellings fail the same silent way; the second is merely harder to notice.
 *
 * That is not hypothetical. The consolidated sessions console (qontinui-web
 * #1142, plan `2026-08-26-sessions-console-consolidation`) files its table in
 * `components/sessions/` — the very next surface after this check shipped — and
 * had to hand-add a fourth directory line to be seen at all.
 *
 * So the component arm is recursive over `src/components/**`. What bounds it is
 * the `*Status.ts` suffix, not the directory: eager globbing EXECUTES every
 * module it matches, and widening to `.tsx` or to route files would import
 * React components into a pure test for no gain. A `*Status.ts` module is by
 * convention a pure kind→presentation table, which is exactly what is safe to
 * import and exactly what can hold an attention table.
 *
 * The `app/` arm stays separate because it crosses out of `components/`; the
 * `prPipeline.ts` arm stays a literal because it is the one attention table
 * that predates the naming convention. Those are the two named exceptions, and
 * neither grows with a new surface.
 *
 * Two traps, both of which fail SILENTLY rather than loudly:
 *
 * - `(app)` is never written literally in a pattern. Parentheses are extglob
 *   syntax, so a pattern containing `/(app)/` matches nothing at all — the
 *   route-group directory has to be crossed with a `**` wildcard instead.
 * - Vite expands these by reading the literal at build time, so the argument
 *   must STAY a literal. Hoisting a pattern into a constant, building one by
 *   template, or wrapping this in a helper all expand to zero modules.
 *
 * Either mistake leaves a discovery that finds nothing and an enrolment check
 * that passes vacuously, which is why clause (2) and the count assertion are
 * not optional decoration.
 *
 * `import.meta.glob` is Vite's, and this file is a TEST: `tsconfig.json`
 * excludes every test file from `npm run type-check`, and the ESLint config is
 * not type-aware, so no ambient `ImportMeta` declaration is needed or wanted
 * here. Declaring one globally would make `import.meta.glob` type-clean in app
 * code too, where Next/webpack does not implement it — trading an editor
 * squiggle in one excluded file for a real error going quiet everywhere else.
 */
const DISCOVERED_MODULES: Record<string, Record<string, unknown>> = {
  // Every `*Status.ts` under `src/components/**`, at ANY depth — `admin/coord/`
  // holds all ten today, but a surface filing its table beside itself is
  // reached without a line being added here. That is the point.
  ...import.meta.glob("../**/*Status.ts", { eager: true }),
  // Every `*Status.ts` under `src/app/**` — the route-colocated half.
  ...import.meta.glob("../../app/**/*Status.ts", { eager: true }),
  // The one table that predates the `*Status.ts` convention.
  ...import.meta.glob("../operations/prPipeline.ts", { eager: true }),
  // The sessions console files its table beside its own surface rather than
  // under `admin/coord/`. Without this line the registry row above is
  // REGISTERED but not DISCOVERED, which clause (2) below fails on — by
  // design: a discovery that silently stops discovering is worse than none.
  ...import.meta.glob("../sessions/*Status.ts", { eager: true }),
};

/**
 * `ATTENTION_BY_KIND`, or a surface-prefixed form of it
 * (`TREE_ATTENTION_BY_KIND`, `PR_ATTENTION_BY_MERGE_STATUS`, …). Every table in
 * the registry is spelled one of these two ways.
 */
const ATTENTION_TABLE_NAME = /^(?:[A-Z0-9]+(?:_[A-Z0-9]+)*_)?ATTENTION_BY_[A-Z0-9_]+$/;

const ATTENTION_VALUES: ReadonlySet<string> = new Set<Attention>([
  "author",
  "waiting",
  "none",
]);

/**
 * A name match alone would be a guess, so the VALUE has to look like a table
 * too: a non-empty plain object whose every value is one of the three
 * attentions. That keeps a same-named constant of another shape from being
 * demanded into the registry.
 */
function isAttentionTable(value: unknown): value is AttentionMap<string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every((v) => typeof v === "string" && ATTENTION_VALUES.has(v))
  );
}

/** Every attention table on disk, with where it was found, for the message. */
const DISCOVERED_TABLES: ReadonlyArray<{
  module: string;
  exportName: string;
  table: AttentionMap<string>;
}> = Object.entries(DISCOVERED_MODULES).flatMap(([module, mod]) =>
  Object.entries(mod)
    .filter(([name, value]) => ATTENTION_TABLE_NAME.test(name) && isAttentionTable(value))
    .map(([exportName, table]) => ({
      module,
      exportName,
      table: table as AttentionMap<string>,
    }))
);

/**
 * Exports that LOOK like an attention table but are not NAMED like one.
 *
 * With the directory list gone, {@link ATTENTION_TABLE_NAME} is the last
 * remembered convention left in the discovery, and it fails the same silent way
 * the directory list did: name a table `SESSION_ATTENTION_FOR_STATE` or
 * `ATTENTION_TABLE` and it is not discovered, so clause (1) never demands a
 * registry row for it and nothing anywhere goes red.
 *
 * Relaxing discovery to shape ALONE is the wrong fix — the shape is three
 * string literals, and a `Record<K, "none">` that means something else entirely
 * would then be dragged into the registry, which is the false positive the name
 * filter exists to prevent. So the name stays load-bearing for discovery, and
 * the asymmetry is reported instead: a `*Status.ts` export whose VALUE is a
 * well-formed attention table and whose NAME is not the convention is either a
 * table that needs renaming or a constant that needs a different shape, and
 * both are a decision for a human rather than something to silently skip.
 *
 * Empty today across all nineteen discovered modules — which is what makes it
 * safe to assert on, and what makes a future non-empty result a real signal
 * rather than accumulated noise.
 */
const SHAPED_BUT_UNNAMED: ReadonlyArray<{ module: string; exportName: string }> =
  Object.entries(DISCOVERED_MODULES).flatMap(([module, mod]) =>
    Object.entries(mod)
      .filter(([name, value]) => !ATTENTION_TABLE_NAME.test(name) && isAttentionTable(value))
      .map(([exportName]) => ({ module, exportName }))
  );

describe("the palette registry enrols every surface — mechanically", () => {
  it("discovery actually reaches modules (a zero here means the patterns rotted)", () => {
    // Without this, both clauses below pass vacuously the moment the globs stop
    // matching — an empty discovery agrees with everything.
    expect(DISCOVERED_TABLES.length).toBeGreaterThanOrEqual(
      CONSOLE_PALETTES.length
    );
  });

  it("every attention table on disk is registered in CONSOLE_PALETTES", () => {
    const registered = new Set<unknown>(
      CONSOLE_PALETTES.map((row) => row.attentionByKind)
    );
    const unenrolled = DISCOVERED_TABLES.filter(
      ({ table }) => !registered.has(table)
    ).map(
      ({ module, exportName }) =>
        `${exportName} (${module}) declares an attention table but has no CONSOLE_PALETTES row — ` +
        `add one so its palette is audited beside every other surface, not only beside itself`
    );
    expect(unenrolled).toEqual([]);
  });

  it("every registered table is reachable by discovery", () => {
    const discovered = new Set<unknown>(DISCOVERED_TABLES.map((d) => d.table));
    const unreachable = CONSOLE_PALETTES.filter(
      (row) => !discovered.has(row.attentionByKind)
    ).map(
      (row) =>
        `${row.surface}: registered, but no discovery pattern reaches the module its ` +
        `attention table lives in — the table belongs in a \`*Status.ts\` module under ` +
        `\`src/components/\` or \`src/app/\`; widening DISCOVERED_MODULES for one more ` +
        `directory is what this check exists to stop, because the next surface then has ` +
        `to remember to do it too`
    );
    expect(unreachable).toEqual([]);
  });

  it("no *Status.ts export is an attention table under a non-conventional name", () => {
    // The last remembered convention in the discovery. A shape-matched export
    // that the name filter rejects is invisible to clause (1) above, and
    // invisible in the same silent way the directory list used to be.
    const misnamed = SHAPED_BUT_UNNAMED.map(
      ({ module, exportName }) =>
        `${exportName} (${module}) has the shape of an attention table but not the name — ` +
        `rename it to \`<SURFACE>_ATTENTION_BY_<KIND>\` so the enrolment check above can ` +
        `see it, or change its shape if it is not one`
    );
    expect(misnamed).toEqual([]);
  });
});

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
