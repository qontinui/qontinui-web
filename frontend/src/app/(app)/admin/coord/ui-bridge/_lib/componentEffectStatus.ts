/**
 * Component actions and their declared effects — every pure derivation the
 * "Controls and what they do" panel renders (style guide R8).
 *
 * The source is the runner's `GET /ui-bridge/control/components`
 * (`relayReads.ts` `fetchRunnerComponents`): `{ components: [...] }`, each
 * component `{ id, name, description?, actions: [{ id, label?, description?,
 * paramSchema?, effect?, path? }], elementIds?, registeredAt, mounted, scope }`
 * (qontinui-runner `src/hooks/ui-bridge-events/utils.ts` `serializeComponent`).
 *
 * **An action's safety class is DECLARED, never re-derived** (served policy
 * `testing` `an-actions-safety-class-is-declared-not-re-derived`). The SDK's
 * `IREffect` is `read` | `write` | `destructive`; the runner forwards the
 * author's declaration verbatim and deliberately never defaults it, so an
 * action nobody classified serializes with NO `effect` key. Such an action is
 * UNDECLARED here and is counted and shown as such — never as `read`, which is
 * the default a consumer could apply and the one this page must not, because
 * it would let an unjudged destructive control read as harmless. A value
 * outside the three (a wrapper app speaking a newer or broken vocabulary) is
 * not a declaration this page can trust either, so it is UNDECLARED too. Nor
 * is the SDK's standard-verb map (`resolveActionEffect`, which falls back to a
 * class keyed on an action id such as `click`): a class that map supplies is
 * nobody's judgement — the same clause's correction says never to cite one as
 * evidence an action was classified — so only the `effect` field is read.
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

export interface ComponentsReading {
  readonly components: readonly ComponentRecord[];
  /** Entries in the array that were not component objects — not listed. */
  readonly unreadable: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

function readAction(v: unknown): ComponentActionRecord | null {
  if (!isRecord(v)) return null;
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
 * read", which is UNKNOWN and never "no components". An action entry that is
 * not an object is dropped from its component, and a component entry that is
 * not an object is counted in `unreadable` rather than silently lost.
 */
export function readComponents(payload: unknown): ComponentsReading | null {
  const list = isRecord(payload) ? payload.components : undefined;
  if (!Array.isArray(list)) return null;
  const components: ComponentRecord[] = [];
  let unreadable = 0;
  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      unreadable += 1;
      return;
    }
    const id = text(entry.id);
    const actions = Array.isArray(entry.actions)
      ? entry.actions
          .map(readAction)
          .filter((a): a is ComponentActionRecord => a !== null)
      : [];
    components.push({
      // The id is the identity; two entries sharing one (a runner and a
      // wrapper registering the same id) keep distinct keys by position.
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
  return { components, unreadable };
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
}

/** How many actions carry each kind, across every component. */
export function countEffects(
  components: readonly ComponentRecord[]
): EffectCounts {
  const counts = { read: 0, write: 0, destructive: 0, undeclared: 0 };
  for (const component of components) {
    for (const action of component.actions) counts[action.effect] += 1;
  }
  return {
    ...counts,
    actions:
      counts.read + counts.write + counts.destructive + counts.undeclared,
    components: components.length,
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
