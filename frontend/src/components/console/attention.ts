/**
 * attention — the console's severity vocabulary, and the invariant that keeps
 * every surface's palette honest about it.
 *
 * **Enforces R3 — "Colour encodes who must act."**
 * See `frontend/docs/console-ui-style-guide.md` §4 (the attention palette) and
 * §2 R3.
 *
 * The rule R3 states is easy to write down and easy to get backwards: red is
 * reserved for "someone must act NOW", amber for "waiting on something else,
 * it will clear itself", and everything else is a calm in-flight hue. The bug
 * it exists to prevent already happened once — a red badge on *"CI hasn't
 * finished"* trained the eye to ignore red, while a failed check sat in amber
 * beside it.
 *
 * A prose rule does not hold that. What holds it is:
 *
 * 1. **Each surface declares a total kind→attention table** (an
 *    {@link AttentionMap}) — the audit table, one line per kind, answering
 *    "must a human act now, or will something else clear this?". `prPipeline`'s
 *    `ATTENTION_BY_KIND` and `alertStatus`'s are both instances.
 * 2. **A unit test asserts the surface's PALETTE agrees with that table** —
 *    {@link paletteDisagreements} is that assertion, generalised out of
 *    `MergePipeline.test.tsx`'s two palette tests so it binds every future
 *    console consumer rather than only the merge pipeline.
 *
 * This module deliberately has **no imports**. `Attention` is declared here
 * rather than in `operations/prPipeline.ts` (which now re-exports it) so the
 * base of the vocabulary sits in the base layer: a console surface can depend
 * on the severity model without pulling in 1500+ lines of merge-train
 * derivation.
 */

/** Who must act on a row. The whole colour system keys off this. */
export type Attention = "author" | "waiting" | "none";

/**
 * One surface's audited kind → attention table. TOTAL over the surface's kind
 * union — that totality is what stops a newly-added kind from rendering with
 * no attention semantics at all.
 */
export type AttentionMap<K extends string> = Readonly<Record<K, Attention>>;

/**
 * Attention for a kind, with an explicit floor for a kind the map does not
 * know.
 *
 * The default floor is `"waiting"`, never `"none"`. An unrecognised kind is a
 * statement of ignorance, and rendering ignorance as calm is the
 * `silent-empty-is-unknown` mistake applied to a badge — the same discipline
 * R6 applies to an unfetched count (`–`, never `0`). `alertStatus`'s `unknown`
 * kind already carries exactly this floor; this is that decision, generalised.
 */
export function attentionOf<K extends string>(
  map: AttentionMap<K>,
  kind: K | string,
  floor: Attention = "waiting"
): Attention {
  return (map as Readonly<Record<string, Attention>>)[kind] ?? floor;
}

/** Ordering of the vocabulary, loudest last. */
export const ATTENTION_RANK: Readonly<Record<Attention, number>> = {
  none: 0,
  waiting: 1,
  author: 2,
};

/**
 * The louder of two attentions — escalation only, never de-escalation.
 *
 * A surface's kind table encodes what the KIND means; a per-row signal
 * (coord's `severity`, a dwell clock that ran out) is evidence the table
 * cannot see. Evidence may raise a row above its kind's floor and must never
 * lower it below it.
 */
export function escalateAttention(a: Attention, b: Attention): Attention {
  return ATTENTION_RANK[b] > ATTENTION_RANK[a] ? b : a;
}

/**
 * The minimum of a `StatusPalette` this audit needs. Structurally satisfied by
 * `statusRow.StatusPalette<K>`; declared separately so `attention.ts` stays
 * import-free and usable from a pure (non-React) test.
 */
export interface AuditablePalette<K extends string> {
  badgeClass: Readonly<Record<K, string>>;
  authorGlyphKinds: ReadonlySet<K>;
}

/**
 * The R3 invariant, as a list of violations. Empty means the palette agrees
 * with the audit table; every entry is a human-readable sentence naming the
 * kind and what is wrong with it.
 *
 * Four clauses, and each one is a bug that has actually shipped:
 *
 * 1. **Every kind has a badge class.** A kind with no entry renders an
 *    unstyled badge — the failure mode of a kind added to the derivation and
 *    forgotten in the palette.
 * 2. **Red ⇔ `author`.** A red badge on a state that needs nobody is what
 *    trained the eye to ignore red.
 * 3. **Amber ⇔ `waiting`.** The mirror clause; without it a `waiting` row can
 *    quietly be painted red and re-create (1)'s damage from the other side.
 * 4. **`✕` ⇔ `author`, exactly.** The glyph set is a hand-maintained string
 *    set TypeScript's exhaustive `Record`s cannot check (web#813 missed it on
 *    the first pass), so it is checked in BOTH directions and by size.
 *
 * Returned rather than asserted so the caller owns the assertion style, and so
 * a failing run names every violating kind at once instead of the first.
 *
 * `perRowKinds` is the ONE declared exemption, and it is narrow on purpose. A
 * kind whose real attention is computed per row — the alerts surface's
 * `unknown`, whose severity decides — has a static entry that is a FLOOR, not
 * the thing that renders; its badge class is resolved at render time
 * (`alertPaletteFor`). Auditing that floor for amber would demand a colour the
 * surface deliberately does not paint.
 *
 * **It skips clause (3) ONLY.** Clauses (1), (2) and (4) still run: a per-row
 * kind must still have a badge class, must still not be painted red unless it
 * is an author kind, and must still obey red ⇔ `✕`. This is deliberately
 * NARROWER than "skip the hue clauses" would be: the inline carve-out this
 * generalises (`alertStatus.test.ts`, `attention === "waiting" && kind !==
 * "unknown"`) only ever exempted amber, and a shared audit that is weaker than
 * the inline check it replaced is a regression dressed as a refactor. The
 * surface's own test still has to cover the per-row resolution.
 */
export function paletteDisagreements<K extends string>(
  attentionByKind: AttentionMap<K>,
  palette: AuditablePalette<K>,
  options: { perRowKinds?: ReadonlySet<K> } = {}
): string[] {
  const problems: string[] = [];
  const kinds = Object.keys(attentionByKind) as K[];
  const perRow = options.perRowKinds;

  for (const kind of kinds) {
    const attention = attentionByKind[kind];
    const cls = palette.badgeClass[kind];
    if (!cls) {
      problems.push(`${kind}: has no badge class`);
      continue;
    }
    const red = /\bbg-red-/.test(cls);
    const amber = /\bbg-amber-/.test(cls);
    // Clause 2 runs for EVERY kind, `perRowKinds` included. The carve-out
    // this parameter generalises (`alertStatus.test.ts`'s inline
    // `attention === "waiting" && kind !== "unknown"`) skipped only the AMBER
    // clause. Exempting red as well would make the shared audit strictly
    // WEAKER than the inline check it replaced, for no gain — a per-row
    // kind whose FLOOR is painted red is a bug on every surface.
    if (red !== (attention === "author")) {
      problems.push(
        `${kind}: attention=${attention} but badge is ${red ? "" : "not "}red`
      );
    }
    if (!perRow?.has(kind) && amber !== (attention === "waiting")) {
      problems.push(
        `${kind}: attention=${attention} but badge is ${amber ? "" : "not "}amber`
      );
    }
    if (attention === "author" && !palette.authorGlyphKinds.has(kind)) {
      problems.push(`${kind}: is red but carries no ✕ glyph`);
    }
  }

  for (const kind of palette.authorGlyphKinds) {
    if (attentionByKind[kind] !== "author") {
      problems.push(`${kind}: carries ✕ but is not an author-action kind`);
    }
  }

  const authorCount = kinds.filter(
    (k) => attentionByKind[k] === "author"
  ).length;
  if (palette.authorGlyphKinds.size !== authorCount) {
    problems.push(
      `glyph set has ${palette.authorGlyphKinds.size} kinds but ${authorCount} kinds are author-action`
    );
  }

  return problems;
}
