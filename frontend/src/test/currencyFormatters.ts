/**
 * currencyFormatters — every EXPORT anywhere under `src/` that formats money,
 * found by what its code DOES rather than by its name (plan
 * `2026-10-23-console-presentation-spaces` D3.1; review rounds 2 and 3 of
 * Phase 1).
 *
 * The cost scan (`costRenderScan.ts`) reads the `app/` and `components/`
 * modules a lens page can reach. A formatter living in `lib/` or `data/` is
 * not one of them: `formatCurrency` in `data/model-costs/calc.ts`, which the
 * repo imports through the `data/model-costs` barrel (`export * from
 * "./calc"`). A lens page rendering `{formatCurrency(fleet.amount, currency)}`
 * would show an unlabelled figure with nothing in the scan saying so — neither
 * the call (`currency` is not a money word: "status currency" is a freshness
 * reading) nor the formatter's `style: "currency"` (a folder the scan does not
 * read).
 *
 * So this module classifies a module's top-level VALUE bindings, then its
 * exports:
 *
 * - **A binding** is a function, a class, a `const` / `let` / `var` of any
 *   initializer (a `NumberFormat` instance, an object of formatters) or an
 *   anonymous `export default`. It is a CURRENCY FORMATTER when its own code
 *   holds what the cost scan calls a currency format or a glued currency
 *   symbol (the caller passes those positions in, `moneyFormatsAt`), or — to
 *   a fixed point — when its code reads a currency formatter: one of the
 *   module's own, one it imports (named or default), a member of a namespace
 *   import that is one (`ns.formatCurrency`, or the namespace handed on
 *   whole), or a module holding one loaded by `import()` / `require()`.
 * - **An export** is a currency formatter under every name the module gives
 *   one: an `export` modifier, an export list (`export { a as b }`, an
 *   imported binding passed on included), `export default` (recorded as
 *   {@link DEFAULT_EXPORT}), a named re-export (`export { a as b } from`),
 *   `export *` (every formatter of the re-exported module but its default)
 *   and `export * as ns` (the namespace `ns`, whole).
 *
 * The cost scan then fails, in a lens-reachable module, any import of one —
 * named, default or a namespace member, re-exported, or loaded with
 * `import()` — under any local name.
 *
 * Modules can also be DECLARED rather than read (`declared`): the cost home,
 * `CostFigure.tsx`, is the one module allowed to render a cost, so importing
 * `CostFigure` from it is the sanctioned route and is not a formatter — but
 * its raw formatter `formatCostAmount` is one, and declaring it so makes a
 * wrapper of it anywhere under `src/` a formatter too.
 *
 * Only modules whose text could matter are parsed: those that mention
 * `currency` or a currency symbol, and — each time a module turns out to
 * export a formatter — the modules that import from it.
 *
 * What it cannot see: a figure formatted somewhere it is not handed code for —
 * the composed build's cloud overlay (outside `src/`; its OSS mirror,
 * `cloud-absent/`, is read through the `@cloud/` alias), a package, or a value
 * that arrives already formatted from the backend. That is the rendered-page
 * check's to catch (`expectPresentationSafe`, `src/test/presentation.tsx`).
 */

import { dirname, join, posix, relative, sep } from "node:path";
import ts from "typescript";

/** Exported currency formatters: `src/`-relative module path → export names. */
export type CurrencyFormatters = ReadonlyMap<string, ReadonlySet<string>>;

/** The export name a module's default export is recorded under. */
export const DEFAULT_EXPORT = "default";

/** The local name an anonymous default export is recorded under (no identifier can be). */
const ANONYMOUS_DEFAULT = "*default*";

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * The `src/`-relative module `specifier` names when imported from `fromFile`
 * (an `@/…` alias, the `@cloud/…` alias's OSS mirror `cloud-absent/…`, or a
 * relative path), resolved against `known` — every module there is — so
 * resolution never touches the disk. `null` for a package, or a path that
 * names no module.
 */
export function resolveSrcModule(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>
): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = posix.normalize(specifier.slice(2));
  else if (specifier.startsWith("@cloud/")) {
    target = posix.normalize(
      `cloud-absent/${specifier.slice("@cloud/".length)}`
    );
  } else if (specifier.startsWith(".")) {
    target = toPosix(
      relative("/src", join("/src", dirname(fromFile), specifier))
    );
  } else return null;
  target = target.replace(/\/+$/, "");
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

/** Static imports and re-exports, then literal `import("…")` and `require("…")`. */
const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module specifier `text` names in an import, a re-export or a load. */
export function moduleSpecifiers(text: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]]
    )
  );
}

/** `x`, `(x)`, `x as T`, `x satisfies T`, `x!` — down to `x`. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The module a call LOADS — `import("…")` or `require("…")` with a literal
 * specifier — or `undefined` when `node` is no such call.
 */
export function loadedSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const loads =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  const first = node.arguments[0];
  return loads && first !== undefined && ts.isStringLiteralLike(first)
    ? first.text
    : undefined;
}

/** What one export of a module exports. */
type ExportTarget =
  /** A binding of the module: its own, a named import, or a namespace import. */
  | { readonly kind: "binding"; readonly local: string }
  /** `export { imported as name } from "module"`. */
  | {
      readonly kind: "reexport";
      readonly module: string;
      readonly imported: string;
    }
  /** `export * as name from "module"`: the module, whole. */
  | { readonly kind: "namespace"; readonly module: string };

/** A parsed module, as far as classification reads it. */
interface ModuleModel {
  readonly source: ts.SourceFile;
  /** Top-level value bindings: local name → the code that is its value. */
  readonly locals: ReadonlyMap<string, ts.Node>;
  /** Named and default imports: local name → where it comes from. */
  readonly imports: ReadonlyMap<
    string,
    { readonly module: string; readonly imported: string }
  >;
  /** Namespace imports: local name → the module. */
  readonly namespaces: ReadonlyMap<string, string>;
  /** Every name the module exports, with what it exports under it. */
  readonly exports: ReadonlyArray<{
    readonly name: string;
    readonly target: ExportTarget;
  }>;
  /** `export * from "module"`: modules every non-default export of which is re-exported. */
  readonly stars: readonly string[];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
  );
}

/** Every name a binding pattern binds: `a`, `{ a, b: c }` → a, c; `[x, ...y]` → x, y. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name)
  );
}

function modelOf(
  file: string,
  source: ts.SourceFile,
  known: ReadonlySet<string>
): ModuleModel {
  const locals = new Map<string, ts.Node>();
  const imports = new Map<string, { module: string; imported: string }>();
  const namespaces = new Map<string, string>();
  const exports: Array<{ name: string; target: ExportTarget }> = [];
  const stars: string[] = [];
  const resolve = (specifier: ts.Expression | undefined) =>
    specifier !== undefined && ts.isStringLiteral(specifier)
      ? resolveSrcModule(file, specifier.text, known)
      : null;

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const origin = resolve(statement.moduleSpecifier);
      if (!clause || clause.isTypeOnly || origin === null) continue;
      if (clause.name) {
        imports.set(clause.name.text, {
          module: origin,
          imported: DEFAULT_EXPORT,
        });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.set(bindings.name.text, origin);
      } else if (bindings) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          imports.set(element.name.text, {
            module: origin,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const origin = resolve(statement.moduleSpecifier);
      // A package, or a path that names no module under src/.
      if (statement.moduleSpecifier !== undefined && origin === null) continue;
      const clause = statement.exportClause;
      if (clause === undefined) {
        if (origin !== null) stars.push(origin);
      } else if (ts.isNamespaceExport(clause)) {
        if (origin !== null) {
          exports.push({
            name: clause.name.text,
            target: { kind: "namespace", module: origin },
          });
        }
      } else {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const local = (element.propertyName ?? element.name).text;
          exports.push({
            name: element.name.text,
            target:
              origin === null
                ? { kind: "binding", local }
                : { kind: "reexport", module: origin, imported: local },
          });
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) continue;
      const value = unwrap(statement.expression);
      if (ts.isIdentifier(value)) {
        exports.push({
          name: DEFAULT_EXPORT,
          target: { kind: "binding", local: value.text },
        });
      } else {
        locals.set(ANONYMOUS_DEFAULT, statement.expression);
        exports.push({
          name: DEFAULT_EXPORT,
          target: { kind: "binding", local: ANONYMOUS_DEFAULT },
        });
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    ) {
      // An overload signature has no body; the implementation is the binding.
      if (ts.isFunctionDeclaration(statement) && !statement.body) continue;
      const local = statement.name?.text ?? ANONYMOUS_DEFAULT;
      locals.set(local, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        exports.push({
          name: hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
            ? DEFAULT_EXPORT
            : local,
          target: { kind: "binding", local },
        });
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        for (const name of boundNames(declaration.name)) {
          locals.set(name, declaration);
          if (exported) {
            exports.push({ name, target: { kind: "binding", local: name } });
          }
        }
      }
    }
  }
  return { source, locals, imports, namespaces, exports, stars };
}

/**
 * Whether the identifier `id` READS the binding it names: not a member name
 * (`x.fmt`), an object key, a JSX attribute name, or the name a declaration
 * binds.
 */
export function isRead(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === id;
  if (ts.isQualifiedName(parent)) return parent.left === id;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isLabeledStatement(parent)
  ) {
    return (parent as { name?: ts.Node }).name !== id;
  }
  if (ts.isBindingElement(parent)) {
    // `{ fmt: f } = x` reads `fmt` from `x`, not the binding `fmt`.
    return parent.name !== id && parent.propertyName !== id;
  }
  if (ts.isJsxAttribute(parent)) return false;
  return true;
}

/** What a binding's code can name that may be a formatter. */
interface ReadContext {
  readonly model: ModuleModel;
  /** The module's own bindings classified so far. */
  readonly localFormatters: ReadonlySet<string>;
  /** Another module's formatter exports, as classified so far. */
  readonly exportsOf: (module: string) => ReadonlySet<string>;
  readonly resolveLoad: (specifier: string) => string | null;
}

/** What a read of a namespace import takes from the formatters its module exports. */
export type NamespaceRead =
  /** `ns.fmt`, `ns["fmt"]`, `const { fmt } = ns`: that formatter. */
  | { readonly kind: "formatter"; readonly name: string }
  /** A read the scan cannot narrow to members — anything can be read from it. */
  | { readonly kind: "escape"; readonly how: string };

/**
 * What reading `id`, a namespace import of a module exporting the formatters
 * `names`, reads of them: one by name (`ns.fmt`, `ns["fmt"]`,
 * `const { fmt } = ns`), or — by a computed key, a rest pattern, or the
 * namespace handed on whole — possibly any. `null` when it reads none.
 */
export function namespaceReadsAny(
  id: ts.Identifier,
  names: ReadonlySet<string>
): NamespaceRead | null {
  if (names.size === 0) return null;
  const parent = id.parent;
  const named = (name: string): NamespaceRead | null =>
    names.has(name) ? { kind: "formatter", name } : null;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
    return named(parent.name.text);
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === id) {
    const key = unwrap(parent.argumentExpression);
    return ts.isStringLiteralLike(key)
      ? named(key.text)
      : { kind: "escape", how: "read by a computed key" };
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === id &&
    ts.isObjectBindingPattern(parent.name)
  ) {
    for (const element of parent.name.elements) {
      if (element.dotDotDotToken) {
        return { kind: "escape", how: "destructured with a rest pattern" };
      }
      const key = element.propertyName ?? element.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        const read = named(key.text);
        if (read !== null) return read;
      } else {
        return { kind: "escape", how: "destructured by a computed key" };
      }
    }
    return null;
  }
  return { kind: "escape", how: "handed on whole" };
}

/** Whether `node`'s code reads a currency formatter (see the module doc). */
function readsFormatter(node: ts.Node, context: ReadContext): boolean {
  const { model, localFormatters, exportsOf, resolveLoad } = context;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || ts.isTypeNode(n)) return;
    if (ts.isIdentifier(n) && isRead(n)) {
      const name = n.text;
      const imported = model.imports.get(name);
      const namespace = model.namespaces.get(name);
      if (
        localFormatters.has(name) ||
        (imported !== undefined &&
          exportsOf(imported.module).has(imported.imported)) ||
        (namespace !== undefined &&
          namespaceReadsAny(n, exportsOf(namespace)) !== null)
      ) {
        found = true;
        return;
      }
    }
    const loaded = loadedSpecifier(n);
    if (loaded !== undefined) {
      const origin = resolveLoad(loaded);
      if (origin !== null && exportsOf(origin).size > 0) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Text that could hold a currency format or a glued symbol. */
const MAY_FORMAT_MONEY = /currency|[$€£¥₹¢]|\b(?:USD|EUR|GBP|JPY)\b/;

export interface CurrencyFormatterOptions {
  /** Every non-test module, `src/`-relative. */
  readonly modules: readonly string[];
  /** A module's text. */
  readonly read: (file: string) => string;
  /**
   * Where a parsed module holds a currency format or a glued symbol: the
   * start offset of each, in `source`.
   */
  readonly moneyFormatsAt: (
    file: string,
    source: ts.SourceFile
  ) => readonly number[];
  /**
   * Modules classified by declaration, never by reading: each one's
   * formatter exports, exactly (the cost home's raw formatter).
   */
  readonly declared?: CurrencyFormatters;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** Classify every module's exports under `src/` (see the module doc). */
export function discoverCurrencyFormatters({
  modules,
  read,
  moneyFormatsAt,
  declared = new Map(),
}: CurrencyFormatterOptions): CurrencyFormatters {
  const known = new Set(modules);
  const models = new Map<string, ModuleModel>();
  const modelFor = (file: string): ModuleModel => {
    let model = models.get(file);
    if (!model) {
      model = modelOf(file, parse(file, read(file)), known);
      models.set(file, model);
    }
    return model;
  };

  const exportsOf = new Map<string, Set<string>>();
  for (const [file, names] of declared) exportsOf.set(file, new Set(names));
  const exportsOfModule = (module: string): ReadonlySet<string> =>
    exportsOf.get(module) ?? new Set();
  const localFormatters = new Map<string, Set<string>>();

  // Who imports whom, read once by pattern, so a module that turns out to
  // export a formatter can send every importer back through the queue.
  let importers: Map<string, Set<string>> | null = null;
  const importersOf = (module: string): ReadonlySet<string> => {
    if (importers === null) {
      importers = new Map();
      for (const file of modules) {
        for (const specifier of moduleSpecifiers(read(file))) {
          const target = resolveSrcModule(file, specifier, known);
          if (target === null) continue;
          let set = importers.get(target);
          if (!set) {
            set = new Set();
            importers.set(target, set);
          }
          set.add(file);
        }
      }
    }
    return importers.get(module) ?? new Set();
  };

  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (file: string) => {
    if (declared.has(file) || queued.has(file)) return;
    queued.add(file);
    queue.push(file);
  };
  for (const file of modules) {
    if (MAY_FORMAT_MONEY.test(read(file))) enqueue(file);
  }
  for (const file of declared.keys()) {
    for (const importer of importersOf(file)) enqueue(importer);
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    queued.delete(file);
    const model = modelFor(file);

    let locals = localFormatters.get(file);
    if (!locals) {
      // Seeded once: the bindings whose own code formats money.
      locals = new Set();
      localFormatters.set(file, locals);
      if (MAY_FORMAT_MONEY.test(model.source.text)) {
        const positions = moneyFormatsAt(file, model.source);
        for (const [name, node] of model.locals) {
          const start = node.getStart(model.source);
          const end = node.getEnd();
          if (positions.some((p) => p >= start && p < end)) locals.add(name);
        }
      }
    }
    // Then the bindings that read one, to a fixed point within the module.
    const context: ReadContext = {
      model,
      localFormatters: locals,
      exportsOf: exportsOfModule,
      resolveLoad: (specifier) => resolveSrcModule(file, specifier, known),
    };
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, node] of model.locals) {
        if (!locals.has(name) && readsFormatter(node, context)) {
          locals.add(name);
          grew = true;
        }
      }
    }

    const exported = exportsOf.get(file) ?? new Set<string>();
    const before = exported.size;
    for (const { name, target } of model.exports) {
      if (exportsFormatter(target, model, locals, exportsOfModule)) {
        exported.add(name);
      }
    }
    for (const starred of model.stars) {
      for (const name of exportsOfModule(starred)) {
        if (name !== DEFAULT_EXPORT) exported.add(name);
      }
    }
    if (exported.size > before) {
      exportsOf.set(file, exported);
      for (const importer of importersOf(file)) enqueue(importer);
    }
  }
  return exportsOf;
}

function exportsFormatter(
  target: ExportTarget,
  model: ModuleModel,
  locals: ReadonlySet<string>,
  exportsOf: (module: string) => ReadonlySet<string>
): boolean {
  switch (target.kind) {
    case "reexport":
      return exportsOf(target.module).has(target.imported);
    case "namespace":
      return exportsOf(target.module).size > 0;
    case "binding": {
      if (locals.has(target.local)) return true;
      const imported = model.imports.get(target.local);
      if (imported !== undefined) {
        return exportsOf(imported.module).has(imported.imported);
      }
      const namespace = model.namespaces.get(target.local);
      return namespace !== undefined && exportsOf(namespace).size > 0;
    }
  }
}
