/**
 * The two audits that keep the console's R3 machinery honest about ITSELF.
 *
 * `attention.test.ts` asserts every REGISTERED palette agrees with its
 * attention table. Both holes in that sentence are closed here, and both were
 * recorded as follow-ups by Phase 3 Wave 2 (qontinui-web#1033):
 *
 * 1. **"registered".** The registry is hand-maintained, so a surface can ship
 *    with no row and be audited by nothing. That is not hypothetical — seven
 *    palettes across Waves 1 and 2 were unregistered at once, each audited
 *    only beside itself. {@link CONSOLE_PALETTES} is now checked against a
 *    SCAN of the source tree.
 *
 * 2. **"agrees".** `paletteDisagreements` tests the `bg-red-` / `bg-amber-`
 *    PREFIX, so a palette that hand-spells `border-red-500/30` where
 *    `AUTHOR_RED` says `/35` passes it. That had already happened —
 *    `planStatus`'s `blocked` carried exactly that drift — and Wave 2's fix
 *    was to import the constants, which nothing enforced. Now something does.
 *
 * ## Why a filesystem scan
 *
 * The thing being audited is *absence*: a surface nobody imported into the
 * registry, a literal nobody routed through the constants. Neither is
 * reachable from the module graph, because not being in it is the defect. The
 * repo already tests this way — `operations/mergeDataOwner.test.ts` and
 * `styles/theme-tokens.test.ts` are the precedents, and the walker below is
 * the same shape as theirs.
 *
 * See `frontend/docs/console-ui-style-guide.md` §4 and §4.2.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { CONSOLE_PALETTES } from "./consoleSurfaces";
import { AUTHOR_RED, UNKNOWN_AMBER, WAITING_AMBER } from "./statusRow";

/** `src/`, resolved from this file rather than from `process.cwd()`. */
const SRC_DIR = join(__dirname, "..", "..");

/** The one module allowed to spell a palette literal: `console/statusRow.tsx`. */
const PALETTE_HOME = "components/console/statusRow.tsx";

/**
 * The console's own surface area — where §4.1's "nothing outside this file may
 * mint a red or an amber" binds.
 *
 * Scoped rather than tree-wide on purpose. The rest of the app has its own
 * reds and ambers (dataset dialogs, the error monitor, the workflow builder)
 * that are not making an R3 claim and must not be dragged into this palette;
 * an audit that flagged them would be noise, and an audit people learn to
 * ignore is worse than none. `components/operations/` IS in scope — the merge
 * pipeline and merge train render at `/admin/coord/pipeline`, and
 * `MergePipeline` is the guide's own exemplar.
 */
const CONSOLE_SCOPE = [
  "components/console/",
  "components/admin/coord/",
  "components/operations/",
  "app/(app)/admin/coord/",
];

/** Every non-test `.ts`/`.tsx` module under a directory. */
function moduleFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) moduleFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return file
    .slice(SRC_DIR.length + 1)
    .split(sep)
    .join("/");
}

/**
 * Blank out `//` and block comments, preserving offsets and newlines.
 *
 * Both scans below read string LITERALS, and a comment quoting a palette
 * string or an attention table is prose about the code, not the code. This
 * codebase writes long explanatory comments that quote both, so scanning raw
 * source would eventually fail on a sentence — with no `eslint-disable`
 * equivalent to silence it, because these are tests rather than lint rules.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) =>
    m.replace(/[^\n]/g, " ")
  );
}

const ALL_MODULES = moduleFiles(SRC_DIR).map((f) => ({
  path: relative(f),
  source: stripComments(readFileSync(f, "utf8")),
}));

/** The console's own modules — the scope both scans below are scoped to. */
const CONSOLE_MODULES = ALL_MODULES.filter((m) =>
  CONSOLE_SCOPE.some((d) => m.path.startsWith(d))
);

// ----------------------------------------------------------------------------
// 1 — every attention table in the tree is registered
// ----------------------------------------------------------------------------

/**
 * A module declares an attention table if it exports a const that is either
 * TYPED as one or NAMED as one. Two independent rules, unioned, because either
 * alone has an obvious evasion: a table typed `as const` carries no
 * `Attention` annotation, and a table named `SEVERITY_TABLE` carries no
 * `ATTENTION` in its name.
 *
 * **The residual hole, stated plainly** — and it is wider than "not annotated
 * and not named". These all evade both rules, and are listed so the next
 * reader does not have to rediscover them:
 *
 *   - `export const X = {…} satisfies AttentionMap<K>` — no `:` annotation;
 *   - `Partial<Record<K, Attention>>`, or `Record<K, Attention | null>` —
 *     only a `Readonly<` wrapper and a bare final `Attention` are matched;
 *   - a lowerCamelCase name, which neither rule's `[A-Z][A-Z0-9_]*` accepts.
 *
 * All 18 surfaces satisfy BOTH rules today, so a new one would have to depart
 * from the convention twice over to slip past — and `attention.test.ts`'s
 * totality clause still binds it the moment anyone registers it. The rules
 * are kept narrow deliberately: a looser pattern buys coverage of shapes
 * nobody writes at the cost of matching identifiers that are not tables.
 */
const TYPED_TABLE =
  /export\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*(?:Readonly<)?(?:Record<[^=]*?,\s*Attention\s*>|AttentionMap<[^=]*?>)|=[^;]*?\bsatisfies\s+(?:Readonly<)?(?:Record<[^;]*?,\s*Attention\s*>|AttentionMap<[^;]*?>))/gs;
const NAMED_TABLE = /export\s+const\s+([A-Z][A-Z0-9_]*ATTENTION[A-Z0-9_]*)\s*[:=]/g;

function declaredTables(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(TYPED_TABLE)) names.add(m[1]);
  for (const m of source.matchAll(NAMED_TABLE)) names.add(m[1]);
  return [...names];
}

describe("the console surface registry is self-enforcing", () => {
  // Scoped to the console, not tree-wide. Tree-wide, any unrelated
  // `export const MAX_ATTENTION_MS` anywhere in `src/` would fail the
  // set-equality clause with a message about palette registration — an audit
  // that reports a surface where there is none teaches people to edit the
  // registry to shut it up. All 18 surfaces are inside this scope.
  const discovered = CONSOLE_MODULES.filter(
    (m) => declaredTables(m.source).length > 0
  )
    .map((m) => m.path)
    .sort();

  const registered = [...new Set(CONSOLE_PALETTES.map((s) => s.module))].sort();

  it("finds the attention tables at all (the scan is not vacuously passing)", () => {
    // A regex that matched nothing would make the clause below trivially true,
    // which is the failure mode of every scan-based test. Pin a floor and one
    // module we know by name.
    expect(discovered.length).toBeGreaterThanOrEqual(15);
    expect(discovered).toContain("components/admin/coord/alertStatus.ts");
  });

  it("registers EVERY attention table in the tree, and names no phantom", () => {
    // Set equality in both directions. Left-to-right is the follow-up's whole
    // point: a new console surface cannot ship audited-by-nothing. Right-to-
    // left catches the other rot — a row pointing at a module that was renamed
    // or deleted, which would otherwise sit in the registry looking like
    // coverage.
    expect(discovered).toEqual(registered);
  });

  it("gives every registered module a distinct row", () => {
    // Uniqueness, not order — the registry is grouped by wave for a reader,
    // and two rows naming one module would let a stale palette hide behind a
    // fresh one while the set-equality clause above still passed.
    const modules = CONSOLE_PALETTES.map((s) => s.module);
    expect(modules).toHaveLength(new Set(modules).size);
  });

  it("declares the table each row actually imported", () => {
    // The `module` path is a string, so it can drift from the import above it.
    // The row's kinds must at least appear in the file it names.
    for (const { surface, module, attentionByKind } of CONSOLE_PALETTES) {
      const file = ALL_MODULES.find((m) => m.path === module);
      expect(file, `${surface}: no module at ${module}`).toBeDefined();
      const kinds = Object.keys(attentionByKind);
      expect(kinds.length, `${surface}: empty attention table`).toBeGreaterThan(
        0
      );
      const missing = kinds.filter((k) => !file!.source.includes(k));
      expect(missing, `${surface}: kinds absent from ${module}`).toEqual([]);
    }
  });
});

// ----------------------------------------------------------------------------
// 2 — nothing outside `statusRow.tsx` mints an R3 palette literal
// ----------------------------------------------------------------------------

/**
 * The three R3 families, and the drift that motivated naming them.
 *
 * `WAITING_AMBER` and `UNKNOWN_AMBER` differ ONLY in a background opacity
 * (`/15` against `/10`) — they are the two-claims-one-hue pair R3 turns on,
 * "something else will clear this" against "we cannot tell whose move this
 * is". A hand-spelled amber is therefore not merely duplication; it is a coin
 * flip between two different statements, and the prefix audit cannot see it.
 *
 * `CI_YELLOW` and `INERT` are deliberately NOT here. §4.1's rule is about red
 * and amber — the hues that encode *who must act* — and those two are the calm
 * families it contrasts them with. `INERT` in particular is the generic
 * neutral badge (`bg-muted text-muted-foreground border-border`) that a dozen
 * unrelated surfaces use for their own reasons; claiming it for the console
 * would make this audit a rename request rather than a correctness check.
 */
const PALETTE_CONSTANTS: ReadonlyArray<{ name: string; value: string }> = [
  { name: "AUTHOR_RED", value: AUTHOR_RED },
  { name: "WAITING_AMBER", value: WAITING_AMBER },
  { name: "UNKNOWN_AMBER", value: UNKNOWN_AMBER },
];

/**
 * Every string literal in a module, single- double- or backtick-quoted.
 *
 * All three arms are newline-bounded, the backtick one included. An arm that
 * could cross newlines pairs backticks SEQUENTIALLY, so a single stray
 * backtick — in a class name, or in prose a comment-strip missed — would
 * shift every later pairing and capture an arbitrary multi-line blob. A class
 * string never spans a line, so bounding the arm costs no real coverage and
 * removes the failure mode entirely.
 */
function stringLiterals(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? ""
  );
}

/**
 * A literal's R3 SIGNATURE: its `bg-` / `text-` / `border-` colour tokens with
 * the `/NN` opacities stripped, sorted. Two literals sharing a signature are
 * the same badge in the same hue family and differ only in tint — which is
 * exactly the drift `paletteDisagreements` is blind to.
 *
 * Non-colour tokens (`font-mono`, `text-[11px]`, layout) are dropped, so a
 * constant used with a prefix still matches. `text-red-400`-style shades are
 * KEPT as themselves, which is what keeps the surrounding app's many
 * unrelated red badges out of this audit: they are a different signature, not
 * a drifted copy of `AUTHOR_RED`.
 */
function paletteSignature(cls: string): string | null {
  const tokens = cls
    .split(/\s+/)
    .filter((t) => /^(bg|text|border)-(red|amber|yellow)-\d{2,3}(\/\d+)?$/.test(t))
    .map((t) => t.replace(/\/\d+$/, ""))
    .sort();
  // A badge needs all three slots. A one-token `text-red-300` is a text
  // colour, not a palette entry.
  const kinds = new Set(tokens.map((t) => t.split("-")[0]));
  return kinds.size === 3 ? tokens.join(" ") : null;
}

/**
 * Signature → the constant(s) that own it. A LIST, not a single name: the two
 * ambers share a signature by design, and a drift message that named only one
 * of them would send the reader to the wrong constant half the time.
 */
const CONSTANT_SIGNATURES = new Map<string, string[]>();
for (const { name, value } of PALETTE_CONSTANTS) {
  const sig = paletteSignature(value);
  if (!sig) continue;
  CONSTANT_SIGNATURES.set(sig, [...(CONSTANT_SIGNATURES.get(sig) ?? []), name]);
}

describe("R3 — only statusRow.tsx may mint an attention colour", () => {
  const inScope = CONSOLE_MODULES.filter((m) => m.path !== PALETTE_HOME);

  it("actually reaches the console's modules (the scan is not vacuous)", () => {
    // A scope typo would make the clause below pass by scanning nothing.
    expect(inScope.length).toBeGreaterThanOrEqual(100);
    expect(inScope.map((m) => m.path)).toContain(
      "components/operations/MergePipeline.tsx"
    );
  });

  const offenders: string[] = [];
  for (const { path, source } of inScope) {
    for (const literal of stringLiterals(source)) {
      const exact = PALETTE_CONSTANTS.find((c) => c.value === literal);
      if (exact) {
        offenders.push(
          `${path}: re-spells ${exact.name} instead of importing it`
        );
        continue;
      }
      const sig = paletteSignature(literal);
      const drifted = sig ? CONSTANT_SIGNATURES.get(sig) : undefined;
      if (drifted) {
        offenders.push(
          `${path}: "${literal}" drifts from ${drifted.join(" / ")} — same hue family, different tint`
        );
      }
    }
  }

  it("finds no hand-spelled or drifted palette literal anywhere in src/", () => {
    // Every entry names the file and the constant it should have imported.
    // The fix is always the same: `import { AUTHOR_RED } from
    // "@/components/console"` and interpolate it, never re-type it.
    expect(offenders).toEqual([]);
  });

  it("would catch the drift that actually shipped", () => {
    // `planStatus.blocked` carried `border-red-500/30` against AUTHOR_RED's
    // `/35` and passed the prefix audit. This is that literal.
    const drifted = "bg-red-500/15 text-red-200 border-red-500/30";
    expect(drifted).not.toBe(AUTHOR_RED);
    expect(paletteSignature(drifted)).toBe(paletteSignature(AUTHOR_RED));
    expect(CONSTANT_SIGNATURES.get(paletteSignature(drifted)!)).toEqual([
      "AUTHOR_RED",
    ]);
  });

  it("does NOT flag a badge from a different hue family", () => {
    // The app outside the console has many red badges that are not this red
    // and are not meant to be. Flagging them would make the audit noise, and
    // an audit people learn to ignore is worse than no audit.
    expect(paletteSignature("bg-red-500/20 text-red-400 border-red-500/30")).not.toBe(
      paletteSignature(AUTHOR_RED)
    );
    // A notice banner: amber background and border, but its text is the
    // light/dark body pair, not a badge foreground.
    expect(
      paletteSignature(
        "rounded-md border border-amber-500/40 bg-amber-500/5 text-amber-700"
      )
    ).not.toBe(paletteSignature(WAITING_AMBER));
  });

  it("keeps the two ambers distinguishable", () => {
    // The pair the signature check exists for: same family, different claim.
    expect(UNKNOWN_AMBER).not.toBe(WAITING_AMBER);
    expect(paletteSignature(UNKNOWN_AMBER)).toBe(
      paletteSignature(WAITING_AMBER)
    );
  });
});
