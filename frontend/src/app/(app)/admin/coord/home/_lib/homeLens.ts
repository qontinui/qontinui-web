/**
 * homeLens — what `/admin/coord/home` renders through the presentation lens,
 * as pure functions (plan `2026-10-23-console-presentation-spaces` Phase 2;
 * D1 "a lens, never a fork", D3.3 "redaction fails closed").
 *
 * The page answers from ONE read of coord's project state, so every region's
 * provenance is that read, dated by when coord generated it. Every free-text
 * carrier the page shows — a question or an approval, a recommendation, a
 * degradation's headline and subject, a repository, a unit's title, an
 * initiative item, coord's own reasons — is rendered through `RedactedText`
 * with a structured descriptor built here, from the item's own fixed fields
 * (`kind · area · status · age`), never from its text.
 *
 * Nothing here decides a colour or a word the operator sees: every function
 * describes what the PRESENTATION shows, and operator mode renders the page's
 * own derivations (`coordHomeStatus.ts`) unchanged.
 */

import {
  WITHHELD,
  type RedactionDescriptor,
  type SectionSource,
} from "@/components/presentation";
import {
  planeLabel,
  type DegradationView,
  type NamedUnit,
  type NeedsMeItem,
  type RepoGroup,
} from "@/components/admin/coord/coordHomeStatus";

// ---------------------------------------------------------------------------
// Provenance — one read, dated by coord's answer
// ---------------------------------------------------------------------------

/** Where every figure on the page comes from. */
export const PROJECT_STATE_SOURCE = "coord's project state";

/**
 * The same read, kept on screen after a newer read failed (style guide §6.5,
 * "A kept reading"): the chip names it as the last read, never as current.
 */
export const PROJECT_STATE_KEPT_SOURCE = "coord's project state, last read";

/** The reading a region renders: when coord generated it, and whether it is kept. */
export interface HomeReading {
  /** Coord's `generated_at` for the answer on screen; null when none was read. */
  readonly generatedAt: string | null;
  /** The latest read failed and this is the last good one (`useProjectState` `stale`). */
  readonly kept: boolean;
}

/**
 * A region's sources, one chip: every region renders the same answer, so each
 * states that read once, the way a column header serves a column. With
 * nothing read the time is unknown, and the chip says UNKNOWN.
 */
export function regionSources(reading: HomeReading): readonly SectionSource[] {
  return [
    {
      source: reading.kept ? PROJECT_STATE_KEPT_SOURCE : PROJECT_STATE_SOURCE,
      asOf: reading.generatedAt,
    },
  ];
}

// ---------------------------------------------------------------------------
// Descriptors — the structured fields that stand in for withheld text
// ---------------------------------------------------------------------------

/** The current tenant's name, which no repository can vouch for. */
export const TENANT_DESCRIPTOR: RedactionDescriptor = { kind: "Project" };

/** A repository named by coord's grouping or a degradation's subject. */
export const REPOSITORY_DESCRIPTOR: RedactionDescriptor = {
  kind: "Repository",
};

/** A needs-you item's own status word — the badge the row shows. */
export function needsStatusWord(
  item: NeedsMeItem
): "approval" | "decide" | "open question" {
  if (item.source === "operator_gate") return "approval";
  return item.recommendation !== null ? "decide" : "open question";
}

/** What a part of a needs-you item is, for its descriptor. */
export type NeedsPart =
  | "item"
  | "Recommendation"
  | "Consequence"
  | "Options"
  | "Work unit";

/**
 * A needs-you item's descriptor: the item (a question, or an approval an
 * agent waits for) or one of its parts, its status word, and its age.
 */
export function needsDescriptor(
  item: NeedsMeItem,
  part: NeedsPart = "item"
): RedactionDescriptor {
  return {
    kind:
      part !== "item"
        ? part
        : item.source === "operator_gate"
          ? "Approval"
          : "Question",
    area: null,
    status: needsStatusWord(item),
    at: item.askedAt,
  };
}

/** The three ways a degradation row is shown. */
export type DegradationRowKind = "degrading" | "declared" | "cleared";

/** When a degradation row is dated: its observed onset, or when it cleared. */
function degradationAt(
  d: DegradationView,
  kind: DegradationRowKind
): string | null {
  return kind === "cleared" ? d.resolvedAt : d.onsetObservedAt;
}

/** A degradation headline's descriptor: its area and its row's status. */
export function degradationDescriptor(
  d: DegradationView,
  kind: DegradationRowKind
): RedactionDescriptor {
  return {
    kind: "Degradation",
    area: planeLabel(d.plane),
    status: kind,
    at: degradationAt(d, kind),
  };
}

/** Coord's subject kinds, as the descriptor names them. */
const SUBJECT_KIND_WORD: Readonly<Record<string, string>> = {
  device: "Machine",
  repo: "Repository",
  service: "Service",
  key: "Alert",
};

/** A degradation subject's descriptor (one that is not a machine). */
export function subjectDescriptor(
  d: DegradationView,
  kind: DegradationRowKind
): RedactionDescriptor {
  return {
    kind: (d.subjectKind && SUBJECT_KIND_WORD[d.subjectKind]) || "Subject",
    area: planeLabel(d.plane),
    status: kind,
    at: degradationAt(d, kind),
  };
}

/**
 * The repository a degradation is about, when coord names one as its subject
 * — the one repository its headline and subject can be attributed to. Any
 * other subject (a machine, a cloud resource, an alert key) belongs to no
 * repository, so its text is withheld while presenting.
 */
export function degradationRepo(d: DegradationView): string | null {
  return d.subjectKind === "repo" ? d.subjectName : null;
}

/** Whether coord names the subject as a machine (alias it, never name it). */
export function isMachineSubject(d: DegradationView): boolean {
  return d.subjectKind === "device";
}

/** Which named list a unit was read from. */
export type NamedListKind = "stalled" | "waitingOnGate";

/** A named unit's descriptor: a work unit, its list's word, and its age. */
export function namedUnitDescriptor(
  u: NamedUnit,
  list: NamedListKind
): RedactionDescriptor {
  return {
    kind: "Work unit",
    area: null,
    status: list === "stalled" ? "no recorded change" : "waiting",
    at: u.lastRecordedChangeAt ?? u.firstInProgressAt,
  };
}

/** An in-scope item of the current initiative. */
export const INITIATIVE_ITEM_DESCRIPTOR: RedactionDescriptor = {
  kind: "Initiative item",
  status: "in scope",
};

/** The keys of initiative items a unit links to that the initiative does not list. */
export const INITIATIVE_KEYS_DESCRIPTOR: RedactionDescriptor = {
  kind: "Item keys",
  status: "not listed",
};

/**
 * Coord's own sentence about why something is the way it is — an exclusion
 * reason, an initiative's parse error. It is written for agents and can quote
 * raw ids, and it belongs to no repository: always withheld while presenting.
 */
export function reasonDescriptor(
  status: string,
  at: string | null
): RedactionDescriptor {
  return { kind: "Reason", area: null, status, at };
}

// ---------------------------------------------------------------------------
// Which repositories a named unit belongs to — bounded, or withheld
// ---------------------------------------------------------------------------

/**
 * The repositories a named unit may belong to, for D3.3's rule that its title
 * shows only when EVERY one of them is first-party — or `null` when they
 * cannot be bounded, which withholds it.
 *
 * Coord names a unit under each repository group it is a member of, but not
 * its full repository list. A unit's class is its own, so a unit with no
 * recorded change sits in the `stalled` class of EVERY group it belongs to,
 * and is named there unless that group's list was cut short. So its
 * repositories are the groups that name it, plus — failing closed — every
 * group whose list of the same kind was truncated (`omitted` above zero) or
 * whose count of what it left out is unknown, since that list may hide it.
 *
 * - A unit named under the unattributed group names no repository: `null`.
 * - A group whose repository is unknown (no key, or a kind this page does not
 *   recognise) cannot bound anything: a unit it names is `null`, and if its
 *   list may hide units, every unit is.
 */
export function namedUnitRepos(
  groups: readonly RepoGroup[] | null,
  list: NamedListKind
): (slug: string) => readonly string[] | null {
  const named = new Map<string, Set<string>>();
  const unbounded = new Set<string>();
  const mayHide = new Set<string>();
  let everyUnitUnbounded = groups === null;
  for (const g of groups ?? []) {
    const namedList = g.named[list];
    if (g.kind === "unattributed_repo") {
      // Its units have no repository; a unit with one is never among them,
      // so a truncated list here hides none of theirs.
      for (const u of namedList?.units ?? []) unbounded.add(u.slug);
      continue;
    }
    const repo = g.kind === "repo" ? g.key : null;
    const complete = namedList !== null && namedList.omitted === 0;
    if (!complete) {
      if (repo === null) everyUnitUnbounded = true;
      else mayHide.add(repo);
    }
    for (const u of namedList?.units ?? []) {
      if (repo === null) {
        unbounded.add(u.slug);
      } else {
        const repos = named.get(u.slug) ?? new Set<string>();
        repos.add(repo);
        named.set(u.slug, repos);
      }
    }
  }
  return (slug) => {
    if (everyUnitUnbounded || unbounded.has(slug)) return null;
    const repos = named.get(slug);
    if (repos === undefined) return null;
    return [...new Set([...repos, ...mayHide])];
  };
}

// ---------------------------------------------------------------------------
// Values shown verbatim only in a shape that cannot name anyone
// ---------------------------------------------------------------------------

/** A plan phase coord says a decision blocks, while presenting: a number, or withheld. */
export function presentedPlanPhase(phase: string): string {
  const trimmed = phase.trim();
  return /^\d{1,3}[a-z]?$/i.test(trimmed) ? trimmed : WITHHELD;
}

/**
 * The initiative's frontmatter status, while presenting. It is the tenant's
 * own typing, so it is not shown verbatim: coord treats only `live` as live
 * (`initiative_block`), and that is the one distinction the view makes.
 */
export function presentedInitiativeStatus(status: string | null): string {
  if (status === null) return "unknown";
  return status.trim() === "live" ? "live" : "not live";
}

/** An ISO-8601 date, optionally with a time: the only shape a date shows in. */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * An initiative's start or end date, while presenting: verbatim when it is an
 * ISO date, `withheld` when it is any other text (the frontmatter is typed by
 * hand and can say anything), and null when there is none.
 */
export function presentedInitiativeDate(date: string | null): string | null {
  if (date === null) return null;
  const trimmed = date.trim();
  return ISO_DATE.test(trimmed) ? trimmed : WITHHELD;
}

/**
 * A list row's key while presenting: its list and its position, so the
 * `data-row-key` attribute `RecordList` writes carries no question id, gate
 * id, device id, repository or source id. Operator mode keeps the page's own
 * keys.
 */
export function presentedRowKey(list: string, index: number): string {
  return `${list}:${index}`;
}
