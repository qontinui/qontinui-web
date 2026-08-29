/**
 * consoleSurfaces — the registry of every console surface's kind→attention
 * table, paired with the palette that renders it.
 *
 * ## Why this is a module and not a `const` in a test file
 *
 * `attention.test.ts` used to hold this list inline, and warned in its own doc
 * that *"forgetting to add a row is the one failure this file cannot catch"* —
 * a warning it had already earned: Wave 1 shipped three palettes and Wave 2
 * four, and **none of the seven were registered**, so each was audited only
 * beside itself. They were added by hand once the gap was noticed. Nothing
 * stopped it happening again, and Phase 3 Wave 2 (qontinui-web#1033) recorded
 * *"making that registry self-enforcing"* as a follow-up.
 *
 * Living in a module is what makes that possible: `consoleSurfaces.test.ts`
 * scans the source tree for attention tables and asserts this list names every
 * one of them. A test file cannot import another test file's local `const`,
 * so the registry had to come out first.
 *
 * ## No runtime consumer, deliberately
 *
 * Nothing in the app imports this module — it is an AUDIT registry, and its
 * import list is its whole point: it reaches into 18 surfaces' status modules,
 * which is exactly what an app module must not do. It is tree-shaken out of
 * every bundle because no route reaches it. Do not import it from a component.
 *
 * ## Adding a surface
 *
 * Add one row. `module` is the path, relative to `src/`, of the file that
 * DECLARES the attention table — the scan matches on that path, so it must be
 * the declaring module and not the re-exporting one.
 *
 * See `frontend/docs/console-ui-style-guide.md` §4.2.
 */

import type { AttentionMap, AuditablePalette } from "./attention";
import {
  AUTHOR_GLYPH_KINDS,
  STATUS_BADGE_CLASS,
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
  VERIFICATION_ATTENTION_BY_KIND,
  VERIFICATION_AUTHOR_GLYPH_KINDS,
  VERIFICATION_CLASS,
} from "@/components/admin/coord/verificationStatus";
// Wave 3 surfaces.
import {
  CLAIM_ATTENTION_BY_PHASE,
  CLAIM_AUTHOR_GLYPH_PHASES,
  CLAIM_PHASE_CLASS,
} from "@/components/admin/coord/onboardingClaimStatus";
// Wave 5 surfaces.
import {
  PROPOSAL_ATTENTION_BY_KIND,
  PROPOSAL_AUTHOR_GLYPH_KINDS,
  PROPOSAL_KIND_CLASS,
} from "@/app/(app)/admin/coord/prompt-document-proposals/proposalStatus";
import {
  CLEARANCE_ATTENTION_BY_KIND,
  CLEARANCE_AUTHOR_GLYPH_KINDS,
  CLEARANCE_RULE_CLASS,
} from "@/app/(app)/admin/coord/gate-clearance/clearanceRuleStatus";
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

export interface ConsoleSurface {
  /** Human-readable name + route, for the test's `it(...)` title. */
  surface: string;
  /**
   * Path of the module DECLARING `attentionByKind`, relative to `src/` and
   * spelled with forward slashes. The self-enforcement scan matches on this,
   * so it must name the declaring file — not a barrel that re-exports it.
   */
  module: string;
  attentionByKind: AttentionMap<string>;
  palette: AuditablePalette<string>;
  /** Kinds whose badge class is resolved per row — see `paletteDisagreements`. */
  perRowKinds?: ReadonlySet<string>;
}

/**
 * Every kind→attention table in the console, paired with the palette that
 * renders it. One row per surface.
 */
export const CONSOLE_PALETTES: ReadonlyArray<ConsoleSurface> = [
  {
    surface: "merge pipeline (/admin/coord/pipeline)",
    module: "components/operations/prPipeline.ts",
    attentionByKind: PIPELINE_ATTENTION,
    palette: {
      badgeClass: STATUS_BADGE_CLASS,
      authorGlyphKinds: AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "alerts (/admin/coord/alerts)",
    module: "components/admin/coord/alertStatus.ts",
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
    module: "components/admin/coord/planStatus.ts",
    attentionByKind: PLAN_ATTENTION_BY_TONE,
    palette: {
      badgeClass: PLAN_TONE_CLASS,
      authorGlyphKinds: PLAN_AUTHOR_GLYPH_TONES as ReadonlySet<string>,
    },
  },
  {
    surface: "trees (/admin/coord/trees)",
    module: "components/admin/coord/treeStatus.ts",
    attentionByKind: TREE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: TREE_BADGE_CLASS,
      authorGlyphKinds: TREE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "questions (/admin/coord/questions)",
    module: "components/admin/coord/questionStatus.ts",
    attentionByKind: QUESTION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: QUESTION_BADGE_CLASS,
      authorGlyphKinds: QUESTION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 2 -------------------------------------------------------
  {
    surface: "memory (/admin/coord/memory)",
    module: "components/admin/coord/memoryStatus.ts",
    attentionByKind: MEMORY_ATTENTION_BY_TONE,
    palette: {
      badgeClass: MEMORY_TONE_CLASS,
      authorGlyphKinds: MEMORY_AUTHOR_GLYPH_TONES as ReadonlySet<string>,
    },
  },
  {
    surface: "pull decisions (/admin/coord/pull-decisions)",
    module: "components/admin/coord/pullDecisionStatus.ts",
    attentionByKind: PULL_ATTENTION_BY_VERDICT,
    palette: {
      badgeClass: PULL_VERDICT_CLASS,
      authorGlyphKinds: PULL_AUTHOR_GLYPH_VERDICTS as ReadonlySet<string>,
    },
  },
  {
    surface: "releases (/admin/coord/releases)",
    module: "components/admin/coord/releaseStatus.ts",
    attentionByKind: RELEASE_ATTENTION_BY_STATE,
    palette: {
      badgeClass: RELEASE_STATE_CLASS,
      authorGlyphKinds: RELEASE_AUTHOR_GLYPH_STATES as ReadonlySet<string>,
    },
  },
  {
    surface: "land + deploy verification (/admin/coord/lands, /deploys)",
    module: "components/admin/coord/verificationStatus.ts",
    attentionByKind: VERIFICATION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: VERIFICATION_CLASS,
      authorGlyphKinds: VERIFICATION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 3 -------------------------------------------------------
  {
    surface: "onboarding claim (/admin/coord/onboarding-status)",
    module: "components/admin/coord/onboardingClaimStatus.ts",
    attentionByKind: CLAIM_ATTENTION_BY_PHASE,
    palette: {
      badgeClass: CLAIM_PHASE_CLASS,
      authorGlyphKinds: CLAIM_AUTHOR_GLYPH_PHASES as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 5 -------------------------------------------------------
  {
    surface: "policy-edit proposals (/admin/coord/prompt-document-proposals)",
    module:
      "app/(app)/admin/coord/prompt-document-proposals/proposalStatus.ts",
    attentionByKind: PROPOSAL_ATTENTION_BY_KIND,
    palette: {
      badgeClass: PROPOSAL_KIND_CLASS,
      authorGlyphKinds: PROPOSAL_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "gate-clearance rules (/admin/coord/gate-clearance)",
    module: "app/(app)/admin/coord/gate-clearance/clearanceRuleStatus.ts",
    attentionByKind: CLEARANCE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: CLEARANCE_RULE_CLASS,
      authorGlyphKinds: CLEARANCE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  // --- Phase 3 Wave 4 — Family C, the tables --------------------------------
  {
    surface: "open PRs (/admin/coord/prs)",
    module: "app/(app)/admin/coord/prs/prStatus.ts",
    attentionByKind: PR_ATTENTION_BY_MERGE_STATUS,
    palette: {
      badgeClass: PR_MERGE_STATUS_CLASS,
      authorGlyphKinds: PR_AUTHOR_GLYPH_STATUSES as ReadonlySet<string>,
    },
  },
  {
    surface: "gates (/admin/coord/gates)",
    module: "app/(app)/admin/coord/gates/gateStatus.ts",
    attentionByKind: GATE_ATTENTION_BY_KIND,
    palette: {
      badgeClass: GATE_KIND_CLASS,
      authorGlyphKinds: GATE_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "tenant autonomy (/admin/coord/policies)",
    module: "app/(app)/admin/coord/policies/policyAutonomyStatus.ts",
    attentionByKind: POLICY_ATTENTION_BY_KIND,
    palette: {
      badgeClass: POLICY_KIND_CLASS,
      authorGlyphKinds: POLICY_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "git-op feed (/admin/coord/git-ops)",
    module: "app/(app)/admin/coord/git-ops/gitOpStatus.ts",
    attentionByKind: GIT_OP_ATTENTION_BY_KIND,
    palette: {
      badgeClass: GIT_OP_KIND_CLASS,
      authorGlyphKinds: GIT_OP_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "memory federation (/admin/coord/federation)",
    module: "app/(app)/admin/coord/federation/federationStatus.ts",
    attentionByKind: FEDERATION_ATTENTION_BY_KIND,
    palette: {
      badgeClass: FEDERATION_KIND_CLASS,
      authorGlyphKinds: FEDERATION_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
  {
    surface: "member access (/admin/coord/members)",
    module: "app/(app)/admin/coord/members/memberStatus.ts",
    attentionByKind: MEMBER_ATTENTION_BY_KIND,
    palette: {
      badgeClass: MEMBER_KIND_CLASS,
      authorGlyphKinds: MEMBER_AUTHOR_GLYPH_KINDS as ReadonlySet<string>,
    },
  },
];
