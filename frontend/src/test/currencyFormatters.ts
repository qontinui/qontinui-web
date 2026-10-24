/**
 * currencyFormatters — every exported function anywhere under `src/` that
 * formats money, found by what its body DOES rather than by its name (plan
 * `2026-10-23-console-presentation-spaces` D3.1; review round 2 of Phase 1).
 *
 * The cost scan (`costRenderScan.ts`) reads the `app/` and `components/`
 * modules a lens page can reach. A formatter living in `lib/` or `data/` —
 * `formatCurrency` in `data/model-costs/calc.ts`, say — is not one of them, so
 * a lens page rendering `{formatCurrency(fleet.amount, currency)}` would show
 * an unlabelled figure with nothing in the scan saying so: neither the call
 * (`currency` is not a money word — "status currency" is a freshness reading)
 * nor the formatter's `style: "currency"` (a folder the scan does not read).
 *
 * So this module classifies functions, not files: an exported function (a
 * declaration, or a `const` bound to an arrow or a function expression) is a
 * CURRENCY FORMATTER when its own body holds what the cost scan calls a
 * currency format or a glued currency symbol (the caller passes that test in,
 * `formatsMoney`), or — to a fixed point — when its body reads a currency
 * formatter, of its own module or imported from another. The cost scan then
 * fails an import of any of them into a lens-reachable module, under any
 * local name.
 *
 * Only modules whose text could matter are parsed: the first round reads
 * modules that mention `currency` or a currency symbol, and each later round
 * reads modules that mention a formatter found so far.
 */

import { dirname, join, posix, relative, sep } from "node:path";
import ts from "typescript";

/** Exported currency formatters: `src/`-relative module path → export names. */
export type CurrencyFormatters = ReadonlyMap<string, ReadonlySet<string>>;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * The `src/`-relative module `specifier` names when imported from `fromFile`
 * (an `@/…` alias or a relative path), resolved against `known` — every module
 * there is — so resolution never touches the disk. `null` for a package, or a
 * path that names no module.
 */
export function resolveSrcModule(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>
): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = posix.normalize(specifier.slice(2));
  else if (specifier.startsWith(".")) {
    target = toPosix(
      relative("/src", join("/src", dirname(fromFile), specifier))
    );
  } else return null;
  for (const candidate of [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}/index.tsx`,
    `${target}/index.ts`,
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** An exported function-like: its name and the node that is its body. */
interface ExportedFunction {
  readonly name: string;
  readonly node: ts.Node;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

/** The module's exported functions, declared or `const`-bound. */
function exportedFunctions(source: ts.SourceFile): ExportedFunction[] {
  const out: ExportedFunction[] = [];
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.push({ name: statement.name.text, node: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          out.push({ name: declaration.name.text, node: declaration });
        }
      }
    }
  }
  return out;
}

/** Local name → `{ module, imported }` for every named import of a module. */
function importBindings(
  file: string,
  source: ts.SourceFile,
  known: ReadonlySet<string>
): Map<string, { module: string; imported: string }> {
  const out = new Map<string, { module: string; imported: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier;
    if (!ts.isStringLiteral(from)) continue;
    const target = resolveSrcModule(file, from.text, known);
    const bindings = statement.importClause?.namedBindings;
    if (target === null || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      out.set(element.name.text, {
        module: target,
        imported: (element.propertyName ?? element.name).text,
      });
    }
  }
  return out;
}

/** Whether `node`'s subtree reads one of `names` as a value. */
function readsAny(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(n) && names.has(n.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Text that could hold a currency format or a glued symbol. */
const MAY_FORMAT_MONEY = /currency|[$€£¥₹¢]|\b(?:USD|EUR|GBP|JPY)\b/;

export interface CurrencyFormatterOptions {
  /** Every non-test module, `src/`-relative. */
  readonly modules: readonly string[];
  /** A module's text. */
  readonly read: (file: string) => string;
  /** Whether a snippet of source holds a currency format or a glued symbol. */
  readonly formatsMoney: (snippet: string, file: string) => boolean;
  /** Modules never classified (the one allowed to render a cost). */
  readonly exclude?: ReadonlySet<string>;
}

/** Classify every exported function under `src/` (see the module doc). */
export function discoverCurrencyFormatters({
  modules,
  read,
  formatsMoney,
  exclude = new Set(),
}: CurrencyFormatterOptions): CurrencyFormatters {
  const known = new Set(modules);
  const parsed = new Map<string, ts.SourceFile>();
  const parse = (file: string) => {
    let source = parsed.get(file);
    if (!source) {
      source = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      parsed.set(file, source);
    }
    return source;
  };
  const found = new Map<string, Set<string>>();
  const add = (file: string, name: string): boolean => {
    let names = found.get(file);
    if (!names) {
      names = new Set();
      found.set(file, names);
    }
    if (names.has(name)) return false;
    names.add(name);
    return true;
  };
  const candidates = modules.filter((file) => !exclude.has(file));

  // Round 0: a body that formats money itself.
  for (const file of candidates) {
    if (!MAY_FORMAT_MONEY.test(read(file))) continue;
    const source = parse(file);
    for (const fn of exportedFunctions(source)) {
      if (formatsMoney(fn.node.getText(source), file)) add(file, fn.name);
    }
  }

  // Then to a fixed point: a body that reads a formatter found so far.
  for (let changed = true; changed; ) {
    changed = false;
    const names = new Set([...found.values()].flatMap((set) => [...set]));
    if (names.size === 0) break;
    const mention = new RegExp(
      `\\b(?:${[...names].map((n) => n.replace(/[$]/g, "\\$")).join("|")})\\b`
    );
    for (const file of candidates) {
      if (!mention.test(read(file))) continue;
      const source = parse(file);
      const local = new Set(found.get(file) ?? []);
      for (const [binding, { module: target, imported }] of importBindings(
        file,
        source,
        known
      )) {
        if (found.get(target)?.has(imported)) local.add(binding);
      }
      if (local.size === 0) continue;
      for (const fn of exportedFunctions(source)) {
        if (found.get(file)?.has(fn.name)) continue;
        if (readsAny(fn.node, local) && add(file, fn.name)) changed = true;
      }
    }
  }
  return found;
}
