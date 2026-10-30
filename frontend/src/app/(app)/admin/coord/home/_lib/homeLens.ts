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
 * (`kind · area · status · age`, leaving out a field its kind does not have),
 * never from its text. A value the page reads against one of its own tables
 * — a decision kind parsed out of question text, a does-not-know source —
 * shows only when the table names it, and in fixed words otherwise;
 * a failed read is explained in the page's fixed words where its arm has
 * some, and withheld otherwise; and a row's key is an alias of the operator's.
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
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  ROUTE_DISABLED_TEXT,
  classifyCoordError,
  deadlineText,
} from "@/components/operations/coordPollError";
import { FAILURE_REASON_WITHHELD } from "@/components/operations/presentedFailure";
import { readErrorBody } from "@/lib/errors/backend-error-message";
import {
  PROJECT_STATE_ROUTE_UNAVAILABLE_TEXT,
  decisionDomainLabel,
  isKnownDecisionDomain,
  isLabelledSource,
  isWatcherSource,
  planeLabel,
  sourceLabel,
  type DegradationView,
  type NamedUnit,
  type NeedsMeItem,
  type PlaneView,
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
// A failed read — explained in fixed words, or its reason withheld
// ---------------------------------------------------------------------------

/** The web proxy could not reach coord (its own `502 coord_unreachable`). */
export const COORD_UNREACHABLE_TEXT = "coord could not be reached — unknown";

/** The web proxy's wait for coord ran out (its own `504 coord_timeout`). */
export const COORD_TIMEOUT_TEXT = "coord did not answer in time — unknown";

/**
 * Why a read of the project-state door failed, in words that quote nothing —
 * or `null` when only the failure's own words can tell it.
 *
 * A presentation must still say "unknown — and here is why" when it can: to
 * an evaluator, that is the evidence that the instrument is real
 * (`audience_profile/external-evaluator`). But a rejection's own message
 * quotes a URL and an upstream body, which can name a host or a client
 * (`presentedFailure.ts`), so this is an ALLOWLIST of the arms whose reason
 * the page states in its own fixed words — decided from the failure's
 * STRUCTURE (status, coord's error body, the web proxy's refusal envelope),
 * never from its text:
 *
 * - a deployment that does not serve the door (404/405/501): the page's own
 *   {@link PROJECT_STATE_ROUTE_UNAVAILABLE_TEXT};
 * - a route an operator switched off: "disabled by operator";
 * - coord's read deadline: its budget only — the loader coord names is its
 *   own vocabulary, so it is not said;
 * - the web proxy's own refusal when it could not reach coord, or gave up
 *   waiting: fixed words for each, never the refusal's rendered sentence,
 *   which carries coord's discriminator token.
 *
 * Every other failure — a status this page does not explain, an unstructured
 * body, a network error — is `null`, and a presentation withholds it. A new
 * or reworded failure therefore fails closed. The answer that parsed as no
 * project state is the page's own sentence, recorded as such by
 * `useProjectState`.
 */
export function presentableProjectStateFailure(err: unknown): string | null {
  const status = httpStatusOf(err);
  const body = httpBodyOf(err);
  const verdict = classifyCoordError(status, body);
  switch (verdict.kind) {
    case "route_unavailable":
      return PROJECT_STATE_ROUTE_UNAVAILABLE_TEXT;
    case "route_disabled":
      return ROUTE_DISABLED_TEXT;
    case "deadline":
      return deadlineText(verdict.budgetMs);
    case "other":
      break;
  }
  if (status === null) return null;
  const reading = readErrorBody(body ?? "", status);
  if (reading.kind !== "refusal") return null;
  switch (reading.refusal.discriminator) {
    case "coord_unreachable":
      return COORD_UNREACHABLE_TEXT;
    case "coord_timeout":
      return COORD_TIMEOUT_TEXT;
    default:
      return null;
  }
}

/**
 * The latest read's failure as this mode may show it: the operator's own
 * words; while presenting, the page's fixed words for it, or
 * {@link FAILURE_REASON_WITHHELD} when only outside words can tell it.
 * `null` (nothing failed) stays `null` in both modes.
 */
export function presentedHomeFailure(
  lastError: string | null,
  presentableError: string | null,
  presenting: boolean
): string | null {
  if (lastError === null || !presenting) return lastError;
  return presentableError ?? FAILURE_REASON_WITHHELD;
}

// ---------------------------------------------------------------------------
// Descriptors — the structured fields that stand in for withheld text
// ---------------------------------------------------------------------------

/**
 * The current tenant's name, which no repository can vouch for. A tenant has
 * no area, status or age on this page, so its line is its kind alone — never
 * three unknowns about fields it does not have.
 */
export const TENANT_DESCRIPTOR: RedactionDescriptor = {
  kind: "Project",
  notApplicable: ["area", "status", "at"],
};

/**
 * A repository named by coord's grouping. Its row's own badge and summary
 * already carry what the page knows of it (its units, by class), so the
 * identity chip is the kind alone — short enough for the row at
 * screen-share size.
 */
export const REPOSITORY_DESCRIPTOR: RedactionDescriptor = {
  kind: "Repository",
  notApplicable: ["area", "status", "at"],
};

/** A needs-you item's own status word — the badge the row shows. */
export function needsStatusWord(
  item: NeedsMeItem
): "approval" | "decide" | "open question" {
  if (item.source === "operator_gate") return "approval";
  return item.recommendation !== null ? "decide" : "open question";
}

/** What a part of a needs-you item is, for its descriptor. */
export type NeedsPart = "item" | "Recommendation" | "Consequence" | "Options";

/**
 * A needs-you item's descriptor: the item (a question, or an approval an
 * agent waits for) or one of its parts, its status word, and its age — a
 * part is the item's own text, so it shares the item's status and age. The
 * work unit a decision blocks is another referent: {@link blockedUnitDescriptor}.
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

/**
 * The work unit a decision blocks. The one fact its row knows about the UNIT
 * is that it is blocked: the decision's status word and asked-at time are
 * the question's, not the unit's, and coord serves the unit's own area and
 * age nowhere on this view, so those read as unknown.
 */
export const BLOCKED_UNIT_DESCRIPTOR: RedactionDescriptor = {
  kind: "Work unit",
  area: null,
  status: "blocked",
  at: null,
};

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

/**
 * An in-scope item of the current initiative: a line of the initiative's
 * document, which has no area or age of its own.
 */
export const INITIATIVE_ITEM_DESCRIPTOR: RedactionDescriptor = {
  kind: "Initiative item",
  status: "in scope",
  notApplicable: ["area", "at"],
};

/**
 * The keys of initiative items a unit links to that the initiative does not
 * list — keys, with no area or age of their own.
 */
export const INITIATIVE_KEYS_DESCRIPTOR: RedactionDescriptor = {
  kind: "Item keys",
  status: "not listed",
  notApplicable: ["area", "at"],
};

/**
 * Coord's own sentence about why something is the way it is — an exclusion
 * reason, an initiative's parse error. It is written for agents and can quote
 * raw ids, and it belongs to no repository: always withheld while presenting.
 * A reason has no area; it is dated by the reading it explains.
 */
export function reasonDescriptor(
  status: string,
  at: string | null
): RedactionDescriptor {
  return { kind: "Reason", status, at, notApplicable: ["area"] };
}

// ---------------------------------------------------------------------------
// The decisions waiting, by kind — a table's words, or fixed words
// ---------------------------------------------------------------------------

/** One decision kind the page's table does not name, while presenting. */
export const UNNAMED_DECISION_KIND = "a kind not named here";

/** Several decision kinds the page's table does not name, while presenting. */
export const UNNAMED_DECISION_KINDS = "kinds not named here";

/**
 * The "By kind of decision" entries while presenting, each `<words> <count>`.
 *
 * In coord's `needs_me` work (qontinui-coord#3053 and its successor) the
 * `needs_me.by_domain` keys are its own buckets (`operator_gate`, `unscanned`,
 * `unclassified`) and, for every other question, the domain it parsed out of
 * the question's TEXT (`escalation_domain`), which that work calls
 * caller-controlled. So a key shows only when the page's table names it
 * (`isKnownDecisionDomain`), in the table's words and in coord's order; every
 * other key, whatever it spells, is folded into ONE entry in fixed words,
 * last, carrying their summed count — the questions are still counted, and
 * no word of theirs is on the screen. An allowlist, so a domain coord starts
 * serving tomorrow reads as "a kind not named here" until the table names it.
 */
export function presentedDecisionDomains(
  byDomain: Readonly<Record<string, number>>
): string[] {
  const named: string[] = [];
  let unnamedKinds = 0;
  let unnamedCount = 0;
  for (const [domain, n] of Object.entries(byDomain)) {
    if (isKnownDecisionDomain(domain)) {
      named.push(`${decisionDomainLabel(domain)} ${n}`);
    } else {
      unnamedKinds += 1;
      unnamedCount += n;
    }
  }
  if (unnamedKinds > 0) {
    named.push(
      `${unnamedKinds === 1 ? UNNAMED_DECISION_KIND : UNNAMED_DECISION_KINDS} ${unnamedCount}`
    );
  }
  return named;
}

// ---------------------------------------------------------------------------
// What this view does not know — a source in the table's words, or fixed words
// ---------------------------------------------------------------------------

/** A `does_not_know` source the page's table does not label, while presenting. */
export const UNLABELLED_SOURCE = "A source this view has no name for";

/**
 * A `does_not_know` row's label while presenting. The page's table labels the
 * sources it knows, and a watcher's row is named by the areas it feeds
 * (`sourceLabel`); for any OTHER source the operator's label is coord's own
 * identifier with its underscores spaced — "Coord.alerts visibility
 * (operator-plane kinds this caller can be served)" — internal vocabulary an
 * evaluator does not share, from a list coord grows without this page. So
 * while presenting such a row reads in fixed words: an allowlist, the rule
 * style guide §3.11 gives a value the console's table does not know. The row
 * is kept, with its state, read time and bound: the source is still counted
 * among what the view does or does not know.
 */
export function presentedSourceLabel(
  source: string,
  planes: PlaneView[] | null
): string {
  return isLabelledSource(source) || isWatcherSource(source)
    ? sourceLabel(source, planes)
    : UNLABELLED_SOURCE;
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
 * List row keys while presenting: an opaque alias of the key operator mode
 * gives the same row.
 *
 * `RecordList` writes a row's key to `data-row-key`, and the page's own keys
 * carry a question id, gate id, device id, repository or source id — so while
 * presenting a row is keyed by an alias instead. The key is also what
 * expansion compares, so the alias must not change which row is open: a key
 * by POSITION would keep "row 2" open when a poll removes the row above it,
 * and the detail on screen would silently become another record's. So the
 * alias is of the WHOLE operator key, index suffix included: a bijection of
 * it, assigned on first sight and never reused, so a presented row opens,
 * stays open and collapses exactly when the operator's would (D1: the mode
 * changes rendering only). One registry per mounted region, kept across
 * polls (`HomeLens.tsx` `useRowKey`).
 */
export class RowKeyAliases {
  private readonly aliases = new Map<string, number>();

  /** The presented key of the row operator mode keys `operatorKey` in `list`. */
  key(list: string, operatorKey: string): string {
    const identity = `${list}\u0000${operatorKey}`;
    let n = this.aliases.get(identity);
    if (n === undefined) {
      n = this.aliases.size + 1;
      this.aliases.set(identity, n);
    }
    return `${list}:row-${n}`;
  }
}
