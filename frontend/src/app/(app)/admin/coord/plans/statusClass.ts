/**
 * Axis A's derived `status_class`, and the "needs a /vet-imp" predicate built
 * on it.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 3.
 * Pure (R8): the page and the row render what this module hands them.
 *
 * Two rules govern every reading here:
 *
 * - **An absent field is an older backend, not a class.** `status_class` is
 *   new on the reconciliation route; a backend that predates it omits the key,
 *   and that renders UNKNOWN — never folded into `unset` (which is a real
 *   class: "nobody ever set a status") and never into "fine".
 * - **`vet_state: null` is UNKNOWN, never `fresh`.** coord's vet-freshness
 *   check may not have run, may predate the field, or may run in shadow mode
 *   (see `deriveMode.ts`). The predicate therefore has THREE answers — yes,
 *   no, and undetermined — and the page counts the third separately rather
 *   than letting it vanish into "no".
 */

import type {
  ReconciliationAxisA,
  ReconciliationStatusClass,
} from "@/components/admin/coord/planReconciliationStatus";

/** coord's five classes, in its own `StatusClass::ALL` report order. */
export const STATUS_CLASSES: readonly ReconciliationStatusClass[] = [
  "derived",
  "attested",
  "free_known",
  "off_vocabulary",
  "unset",
];

const CLASS_LABEL: Record<ReconciliationStatusClass, string> = {
  derived: "derived",
  attested: "attested",
  free_known: "free",
  off_vocabulary: "off-vocabulary",
  unset: "unset",
};

const CLASS_DETAIL: Record<ReconciliationStatusClass, string> = {
  derived:
    "coord computes this status (ready / shipped) from the unit's PR citations.",
  attested:
    "A non-owner judgment (vetted / superseded / obsolete) — it stays true only while the plan it judged is unchanged.",
  free_known:
    "A recognized Free-tier word (draft / in_progress / blocked) — nobody has vetted this plan yet.",
  off_vocabulary:
    "A status word coord does not recognize. coord accepts it, and every lifecycle query is blind to it — needs cleanup.",
  unset: "No status was ever set — needs cleanup.",
};

/** off_vocabulary and unset: the "needs cleanup" bucket, never "other". */
export function isNeedsCleanup(cls: ReconciliationStatusClass): boolean {
  return cls === "off_vocabulary" || cls === "unset";
}

export interface StatusClassReading {
  /** The class, or `unknown` when this read cannot say which. */
  kind: ReconciliationStatusClass | "unknown" | "no_unit";
  label: string;
  detail: string;
  unknown: boolean;
  needsCleanup: boolean;
}

/** The class cell for one row. */
export function describeStatusClass(
  axis: ReconciliationAxisA
): StatusClassReading {
  if (!axis.readable) {
    return {
      kind: "unknown",
      label: "class unknown",
      detail:
        "coord's stored status could not be read, so its class is UNKNOWN." +
        (axis.unreadable_reason ? ` ${axis.unreadable_reason}` : ""),
      unknown: true,
      needsCleanup: false,
    };
  }
  if (!axis.present) {
    return {
      kind: "no_unit",
      label: "no unit",
      detail:
        "No coord work unit exists for this stem, so there is no stored status to classify.",
      unknown: false,
      needsCleanup: false,
    };
  }
  if (axis.status_class === undefined) {
    return {
      kind: "unknown",
      label: "class not reported",
      detail:
        "This backend predates status_class on the reconciliation route, so the class is UNKNOWN — not unset.",
      unknown: true,
      needsCleanup: false,
    };
  }
  const cls = axis.status_class;
  if (cls === null || !STATUS_CLASSES.includes(cls)) {
    return {
      kind: "unknown",
      label: "class unknown",
      detail:
        cls === null
          ? "The route served no class for a unit it read, so the class is UNKNOWN."
          : `The route served a class this console does not know ("${String(cls)}") — UNKNOWN.`,
      unknown: true,
      needsCleanup: false,
    };
  }
  return {
    kind: cls,
    label: CLASS_LABEL[cls],
    detail: CLASS_DETAIL[cls],
    unknown: false,
    needsCleanup: isNeedsCleanup(cls),
  };
}

// ---------------------------------------------------------------------------
// The status-class filter
// ---------------------------------------------------------------------------

export type StatusClassFilter =
  | "any"
  | ReconciliationStatusClass
  | "needs_cleanup"
  | "unknown";

export const STATUS_CLASS_FILTERS: readonly {
  value: StatusClassFilter;
  label: string;
}[] = [
  { value: "any", label: "Any class" },
  { value: "derived", label: "Derived" },
  { value: "attested", label: "Attested" },
  { value: "free_known", label: "Free (known word)" },
  { value: "needs_cleanup", label: "Needs cleanup (off-vocab or unset)" },
  { value: "off_vocabulary", label: "Off-vocabulary only" },
  { value: "unset", label: "Unset only" },
  { value: "unknown", label: "Class unknown" },
];

/**
 * Does this row's class match? An UNKNOWN class matches only `any` and
 * `unknown` — letting it fall into whichever bucket is selected would answer
 * a question the read did not answer. A row with no coord unit has no class
 * and matches only `any`.
 */
export function matchesStatusClass(
  axis: ReconciliationAxisA,
  filter: StatusClassFilter
): boolean {
  if (filter === "any") return true;
  const reading = describeStatusClass(axis);
  if (filter === "unknown") return reading.kind === "unknown";
  if (filter === "needs_cleanup") return reading.needsCleanup;
  return reading.kind === filter;
}

// ---------------------------------------------------------------------------
// Needs a /vet-imp
// ---------------------------------------------------------------------------

/** The vet-freshness verdicts that mean the attested plan has changed. */
const DECAYED_VET_STATES: ReadonlySet<string> = new Set(["moved", "gone"]);

export type VetImpNeed = "yes" | "no" | "undetermined";

export interface VetImpReading {
  need: VetImpNeed;
  why: string;
}

/**
 * `status_class == free_known` OR (`status_class == attested` AND `vet_state`
 * in {moved, gone}).
 *
 * The third answer exists because the predicate's second arm reads a value
 * that is often absent: an attested unit whose `vet_state` is `null` is NOT
 * "no" — nobody knows whether its plan moved.
 */
export function needsVetImp(axis: ReconciliationAxisA): VetImpReading {
  const cls = describeStatusClass(axis);
  if (cls.kind === "no_unit") {
    return {
      need: "no",
      why: "No coord work unit for this stem — the predicate reads a unit's class.",
    };
  }
  if (cls.kind === "unknown") {
    return { need: "undetermined", why: cls.detail };
  }
  if (cls.kind === "free_known") {
    return {
      need: "yes",
      why: `Status "${axis.status ?? ""}" is a Free-tier word — nobody has vetted this plan.`,
    };
  }
  if (cls.kind === "attested") {
    const vet = axis.vet_state;
    if (vet === undefined || vet === null) {
      return {
        need: "undetermined",
        why:
          "Attested, but coord's vet-freshness verdict is UNKNOWN for this unit " +
          (vet === undefined
            ? "(this backend does not forward vet_state)"
            : "(never checked, or not reported)") +
          " — whether the vetted plan has since moved is not known.",
      };
    }
    if (DECAYED_VET_STATES.has(vet)) {
      return {
        need: "yes",
        why: `Attested, but the plan it judged has ${vet === "gone" ? "gone" : "moved"} since (vet_state ${vet}).`,
      };
    }
    return {
      need: "no",
      why: `Attested, and coord's vet-freshness verdict is "${vet}".`,
    };
  }
  return {
    need: "no",
    why: `Class ${cls.label} is not one the predicate selects.`,
  };
}
