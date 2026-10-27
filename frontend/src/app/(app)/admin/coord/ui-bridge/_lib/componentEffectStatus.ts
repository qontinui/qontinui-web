/**
 * Component actions and their declared effects — every pure derivation the
 * "Controls and what they do" panel renders (style guide R8).
 *
 * The source is the runner's `GET /ui-bridge/control/components`
 * (`relayReads.ts` `fetchRunnerComponents`): `{ components: [...],
 * wrapperComponents }`, each component `{ id, name, description?, actions: [{
 * id, label?, description?, paramSchema?, effect?, path? }], elementIds?,
 * registeredAt, mounted, scope }` (qontinui-runner
 * `src/hooks/ui-bridge-events/utils.ts` `serializeComponent`).
 *
 * **Whose components these are is the runner's to say, and it says it.** Read
 * locally, the route merges the runner's own registry with the reply of every
 * live WebSocket-wrapper app; read over the relay, the only way this page
 * reads it, it returns the runner's OWN registry and asks no wrapper app
 * (qontinui-runner `afc970df9`, `ui_bridge::elements::ComponentSources`).
 * `data.wrapperComponents` carries the difference — `"withheld"` or
 * `"included"` — so a list with no wrapper entries can be told from "none is
 * registered" and from "none was asked". {@link readWrapperDisclosure} reads
 * it, and the panel states it: this page never implies wrapper apps were
 * consulted. A reply that sends no such field (a build that predates it) or
 * any other value is UNKNOWN, never read as either.
 *
 * **An action's safety class is DECLARED, never re-derived** (served policy
 * `testing` `an-actions-safety-class-is-declared-not-re-derived`). The SDK's
 * `IREffect` is `read` | `write` | `destructive`; the runner forwards the
 * author's declaration verbatim and deliberately never defaults it, so an
 * action nobody classified serializes with NO `effect` key. Such an action is
 * UNDECLARED here and is counted and shown as such — never as `read`, which is
 * the default a consumer could apply and the one this page must not, because
 * it would let an unjudged destructive control read as harmless. A value
 * outside the three (the runner's own registry speaking a newer or broken
 * vocabulary) is not a declaration this page can trust either, so it is
 * UNDECLARED too. Nor is the SDK's standard-verb map (`resolveActionEffect`,
 * which falls back to a class keyed on an action id such as `click`): a class
 * that map supplies is nobody's judgement — the same clause's correction says
 * never to cite one as evidence an action was classified — so only the
 * `effect` field is read.
 *
 * Colour follows R3 — who must act, not how alarming the word sounds. A
 * declared `write` or `destructive` is a FACT about the control, not a fault,
 * so all three declared classes are calm and differ in their words. Only
 * UNDECLARED is amber: it is R3's ignorance floor ("we cannot tell you what
 * this does"), and nothing but an author declaring the effect clears it.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type StatusPalette,
} from "@/components/console";

/** The SDK's declared effect classes (`IREffect`). */
export type DeclaredEffect = "read" | "write" | "destructive";

/** What this page shows for an action: a declared class, or UNDECLARED. */
export type EffectKind = DeclaredEffect | "undeclared";

/** Every kind, in the order the page lists them. */
export const EFFECT_KINDS: readonly EffectKind[] = [
  "read",
  "write",
  "destructive",
  "undeclared",
];

/**
 * The kind an action's `effect` field declares. Exactly the three SDK values
 * are declarations; anything else — absent, `null`, a typo, another
 * vocabulary — is UNDECLARED. There is no default.
 */
export function effectKindOf(effect: unknown): EffectKind {
  return effect === "read" || effect === "write" || effect === "destructive"
    ? effect
    : "undeclared";
}

/**
 * Who must act on an action's effect. The three declared classes — none: a
 * declaration is the author's statement, reflected back. `undeclared` —
 * WAITING, the ignorance floor (R3): this page cannot say what the control
 * does, and only its author can.
 */
export const EFFECT_ATTENTION_BY_KIND = {
  read: "none",
  write: "none",
  destructive: "none",
  undeclared: "waiting",
} satisfies AttentionMap<EffectKind>;

export const EFFECT_BADGE_CLASS: Record<EffectKind, string> = {
  read: INERT,
  write: INERT,
  destructive: INERT,
  undeclared: UNKNOWN_AMBER,
};

export const EFFECT_AUTHOR_GLYPH_KINDS: ReadonlySet<EffectKind> =
  new Set<EffectKind>();

export const EFFECT_PALETTE: StatusPalette<EffectKind> = {
  badgeClass: EFFECT_BADGE_CLASS,
  authorGlyphKinds: EFFECT_AUTHOR_GLYPH_KINDS,
};

/** The badge label for each kind. */
export const EFFECT_LABEL: Record<EffectKind, string> = {
  read: "read",
  write: "write",
  destructive: "destructive",
  undeclared: "undeclared",
};

/** What each kind means, for the badge's title. */
export const EFFECT_MEANING: Record<EffectKind, string> = {
  read: "Declared read: pressing it only reads",
  write: "Declared write: pressing it changes state",
  destructive: "Declared destructive: pressing it deletes or cannot be undone",
  undeclared:
    "Undeclared: its author declared no effect, so what it does is unknown — counted as undeclared, never assumed to be a read",
};

export interface ComponentActionRecord {
  readonly id: string | null;
  readonly label: string | null;
  readonly description: string | null;
  readonly effect: EffectKind;
  /**
   * The raw `effect` value when it was present but not one of the three
   * declarations — so a malformed declaration is distinguishable from a
   * missing one in the detail. `undefined` when absent or a real declaration.
   */
  readonly unrecognisedEffect?: string;
  /**
   * Set when the entry in the component's `actions` array was not an action
   * object at all. It is still an entry in the list of things the component
   * offers, and nothing about it declares an effect, so it is counted — as
   * UNDECLARED, never dropped (a dropped entry would undercount the one
   * number this page exists to show).
   */
  readonly unreadable?: true;
}

export interface ComponentRecord {
  /** Stable list key: the component's id, or a positional fallback. */
  readonly key: string;
  readonly id: string | null;
  readonly name: string | null;
  readonly description: string | null;
  /** `global` (any route) or `route` (only while its page is active). */
  readonly scope: "global" | "route" | null;
  readonly mounted: boolean | null;
  /** Epoch ms when it registered, or null. */
  readonly registeredAt: number | null;
  readonly actions: readonly ComponentActionRecord[];
}

/**
 * Whether wrapper apps — applications that connect to the runner's UI Bridge
 * from outside it — were asked for their components, as the runner reports it
 * in `data.wrapperComponents`:
 *
 * - `withheld` — not asked: the list is the runner's own registry only. What
 *   every relayed read says, and so what this page expects;
 * - `included` — asked: the list merges the runner's registry with every live
 *   wrapper app's, and does not say which entry came from where;
 * - `unknown` — the reply did not say, or said something else. Never read as
 *   either of the two, and `reason` says which, in words that quote nothing the
 *   reply sent.
 */
export type WrapperDisclosure =
  | { readonly kind: "withheld" }
  | { readonly kind: "included" }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * The disclosure in a components payload. Exactly the runner's two words are
 * answers: an absent field (a build that predates the disclosure) and any
 * other value — a different case, a boolean, `null` — are UNKNOWN. A guess in
 * either direction is a claim about whose entries these are that nothing
 * observed.
 */
export function readWrapperDisclosure(payload: unknown): WrapperDisclosure {
  const said = isRecord(payload) ? payload.wrapperComponents : undefined;
  if (said === "withheld") return { kind: "withheld" };
  if (said === "included") return { kind: "included" };
  return {
    kind: "unknown",
    reason:
      said === undefined
        ? "this runner's reply does not say (an older runner build does not)"
        : "this runner's reply gave an answer this page does not know",
  };
}

/** The disclosure as one sentence — what the panel prints beside the counts. */
export function wrapperDisclosureText(disclosure: WrapperDisclosure): string {
  switch (disclosure.kind) {
    case "withheld":
      return "Wrapper apps — applications connected to the runner from outside it — are not consulted over the relay, so this is the runner's own registry only.";
    case "included":
      return "Wrapper apps were consulted: this list merges the runner's own registry with every connected wrapper app's, and it does not say which entry came from which.";
    case "unknown":
      return `Whether wrapper apps were consulted is unknown: ${disclosure.reason}.`;
  }
}

export interface ComponentsReading {
  readonly components: readonly ComponentRecord[];
  /**
   * Entries in the array that could not be read as a component — not an
   * object, or an object whose `actions` is not an array (the runner's
   * `serializeComponent` always sends one) — so they are not listed and their
   * actions are not counted: every count is a floor while this is above 0.
   */
  readonly unreadable: number;
  /** Whose components these are — see {@link WrapperDisclosure}. */
  readonly wrappers: WrapperDisclosure;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** An action entry that is not an action object: undeclared, nothing more known. */
const UNREADABLE_ACTION: ComponentActionRecord = {
  id: null,
  label: null,
  description: null,
  effect: "undeclared",
  unreadable: true,
};

function readAction(v: unknown): ComponentActionRecord {
  if (!isRecord(v)) return UNREADABLE_ACTION;
  const effect = effectKindOf(v.effect);
  const raw = v.effect;
  const unrecognised =
    effect === "undeclared" && raw !== undefined && raw !== null
      ? String(raw)
      : undefined;
  return {
    id: text(v.id),
    label: text(v.label),
    description: text(v.description),
    effect,
    ...(unrecognised !== undefined ? { unrecognisedEffect: unrecognised } : {}),
  };
}

/**
 * The components in a `GET /ui-bridge/control/components` payload, or `null`
 * when the payload carries no `components` array — "the registry was not
 * read", which is UNKNOWN and never "no components". Nothing is dropped
 * silently: an action entry that is not an object is counted as an
 * UNDECLARED action, and a component entry that is not an object, or whose
 * `actions` is not an array, is counted in `unreadable` — its actions are
 * unknown, never "no actions".
 */
export function readComponents(payload: unknown): ComponentsReading | null {
  const list = isRecord(payload) ? payload.components : undefined;
  if (!Array.isArray(list)) return null;
  const components: ComponentRecord[] = [];
  let unreadable = 0;
  list.forEach((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.actions)) {
      unreadable += 1;
      return;
    }
    const id = text(entry.id);
    const actions = entry.actions.map(readAction);
    components.push({
      // The id is the identity; two entries sharing one (the same component
      // registered twice) keep distinct keys by position.
      key: id ? `${id}#${index}` : `component#${index}`,
      id,
      name: text(entry.name),
      description: text(entry.description),
      scope:
        entry.scope === "global" || entry.scope === "route"
          ? entry.scope
          : null,
      mounted: typeof entry.mounted === "boolean" ? entry.mounted : null,
      registeredAt:
        typeof entry.registeredAt === "number" &&
        Number.isFinite(entry.registeredAt)
          ? entry.registeredAt
          : null,
      actions,
    });
  });
  return { components, unreadable, wrappers: readWrapperDisclosure(payload) };
}

export interface EffectCounts {
  readonly read: number;
  readonly write: number;
  readonly destructive: number;
  /** Actions with no recognised declaration — the count this page exists to show. */
  readonly undeclared: number;
  /** Every action, all four kinds. */
  readonly actions: number;
  readonly components: number;
  /**
   * Registry entries that could not be read and so are in none of the counts
   * above ({@link ComponentsReading.unreadable}): while it is above 0, every
   * count is a floor.
   */
  readonly unreadable: number;
}

/**
 * A count as this page states it: exact, or — while registry entries could
 * not be read (`unreadable` above 0) — a floor, `≥N`, the spelling the app
 * total uses. The health strip and the panel's header both take it, so the
 * header shown over a closed panel (R7) never states a floor as an exact
 * figure beside a strip that calls it one.
 */
export function effectCountValue(
  n: number,
  unreadable: number
): number | string {
  return unreadable > 0 ? `≥${n}` : n;
}

/** "1 registry entry could not be read and is not counted" — why a count is a floor. */
export function unreadableEntriesText(unreadable: number): string {
  return `${unreadable} registry ${unreadable === 1 ? "entry" : "entries"} could not be read and ${
    unreadable === 1 ? "is" : "are"
  } not counted`;
}

/** How many actions carry each kind, across every component read. */
export function countEffects(
  reading: Pick<ComponentsReading, "components" | "unreadable">
): EffectCounts {
  const counts = { read: 0, write: 0, destructive: 0, undeclared: 0 };
  for (const component of reading.components) {
    for (const action of component.actions) counts[action.effect] += 1;
  }
  return {
    ...counts,
    actions:
      counts.read + counts.write + counts.destructive + counts.undeclared,
    components: reading.components.length,
    unreadable: reading.unreadable,
  };
}

/**
 * The one kind a component's row shows: its most consequential action —
 * undeclared over destructive over write over read — or `null` for a
 * component with no actions.
 */
export function componentEffectKind(
  component: ComponentRecord
): EffectKind | null {
  const kinds = new Set(component.actions.map((a) => a.effect));
  for (const kind of ["undeclared", "destructive", "write", "read"] as const) {
    if (kinds.has(kind)) return kind;
  }
  return null;
}

/** "3 actions: 2 read, 1 undeclared" — a component's split, in words. */
export function actionSplitText(component: ComponentRecord): string {
  const n = component.actions.length;
  if (n === 0) return "no actions";
  const parts = EFFECT_KINDS.map((kind) => {
    const k = component.actions.filter((a) => a.effect === kind).length;
    return k > 0 ? `${k} ${EFFECT_LABEL[kind]}` : null;
  }).filter(Boolean);
  return `${n} ${n === 1 ? "action" : "actions"}: ${parts.join(", ")}`;
}

/** A component's descriptor status word, from a fixed vocabulary (D3.3). */
export function componentStatusWord(component: ComponentRecord): string {
  const kind = componentEffectKind(component);
  switch (kind) {
    case null:
      return "no actions";
    case "undeclared":
      return "has undeclared actions";
    case "destructive":
      return "has destructive actions";
    case "write":
      return "writes";
    case "read":
      return "reads only";
  }
}
