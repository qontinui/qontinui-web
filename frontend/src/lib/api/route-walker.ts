/**
 * Static walker behind `route-walker.test.ts`: finds every `HttpClient` call
 * site in a TypeScript source, resolves its `(method, path template)`, and
 * checks that pair against the backend OpenAPI snapshot
 * (`lib/api-client/openapi-schema.json`, which backend CI regenerates from
 * `app.openapi()` and fails on any difference).
 *
 * Everything here except `loadSnapshotPaths` is pure — it takes source text
 * and a `paths` object — so the test can drive it on in-memory fixtures as
 * well as on the real tree. It is imported by tests only; nothing in the app
 * bundle depends on it.
 *
 * Plan: 2026-09-12-four-frontend-routes-the-retry-sweep-found-dead-or-mismatched
 * (Phase 5).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** `paths` of the OpenAPI snapshot: template -> { method -> operation }. */
export type SnapshotPaths = Record<string, Record<string, unknown>>;

/**
 * The composed backend snapshot's `paths`, resolved relative to this file.
 * The single loader for the `lib/api` route tests — `route-contract.test.ts`
 * reads it through here too.
 */
export function loadSnapshotPaths(): SnapshotPaths {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../api-client/openapi-schema.json"
  );
  return JSON.parse(readFileSync(file, "utf8")).paths;
}

/**
 * Snapshot parameter names that FastAPI declares with the `:path` converter
 * (`{repo:path}`, `{file_path:path}`, …) and that therefore span one or more
 * segments. OpenAPI strips the converter, so the snapshot alone cannot say
 * which `{x}` is multi-segment; this list is read off `backend/app` with
 * `grep -rhoE '\{[a-z0-9_]+:path\}' backend/app`. A name missing here only
 * makes the walker stricter (a false `dead`), never laxer.
 */
export const MULTI_SEGMENT_PARAMS: ReadonlySet<string> = new Set([
  "path",
  "file_path",
  "repo",
  "screenshot_path",
  "s3_key",
]);

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

const VERB_HELPERS = ["get", "post", "put", "patch", "delete"] as const;
const CALL_NAMES: ReadonlySet<string> = new Set(["fetch", ...VERB_HELPERS]);

/** A resolved URL placeholder for a substitution the walker cannot know. */
const PARAM = "{param}";

export interface CallSite {
  /** Path relative to `frontend/src`, forward slashes. */
  file: string;
  line: number;
  /** Upper-case HTTP method, or `null` when it could not be read statically. */
  method: string | null;
  /**
   * The URL with origin and query string removed and every unknown
   * substitution as `{param}`; `null` when the URL could not be resolved.
   */
  path: string | null;
  /** `ws:`/`wss:` scheme on the resolved URL. */
  wsScheme: boolean;
  /** Source text of the URL argument, whitespace-collapsed. */
  urlText: string;
  /** Why `method` or `path` is `null`. */
  unresolvedWhy?: string;
}

/**
 * Parses the module an import specifier names, relative to the importing
 * file, or returns `null`. Supplied by the tree walk; fixtures pass none, so
 * an imported value there is `unresolved`.
 */
export type ModuleLoader = (
  fromFile: string,
  specifier: string
) => ts.SourceFile | null;

/** A URL expression's possible values (branches of a conditional, returns of a helper). */
type Resolved = { ok: true; texts: string[] } | { ok: false; why: string };

const MAX_ALTERNATIVES = 16;
const MAX_DEPTH = 24;

const unresolved = (why: string): Resolved => ({ ok: false, why });
const literal = (text: string): Resolved => ({ ok: true, texts: [text] });

/**
 * A substitution named like this carries a query string or suffix, not a
 * path segment: the path is cut where it starts.
 */
const QUERY_NAME =
  /^(query|qs|querystring|queryparams|params|searchparams|search|suffix|filters?|urlparams)$/i;

/** Marker for "the query string starts here"; cut at by `pathOf`. */
const QUERY_MARK = "?";

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

/** Final property/identifier name of an expression, e.g. `this.a.httpClient` -> `httpClient`. */
function tailName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function isHttpClientType(type: ts.TypeNode | undefined): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "HttpClient"
  );
}

/**
 * Names that hold an `HttpClient` in this file: always `httpClient` (the
 * shared singleton and every service's field), plus anything declared with an
 * `HttpClient` annotation or initialised with `new HttpClient(...)`.
 */
function httpClientNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(["httpClient"]);
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name)
    ) {
      const init = node.initializer && unwrap(node.initializer);
      const constructed =
        init !== undefined &&
        ts.isNewExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === "HttpClient";
      if (isHttpClientType(node.type) || constructed) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

/** What a name refers to, found by walking scopes outward (then imports). */
type Binding =
  | { kind: "value"; expr: ts.Expression }
  | { kind: "let"; decl: ts.VariableDeclaration; scope: ts.Node }
  | { kind: "param"; decl: ts.ParameterDeclaration }
  | { kind: "function"; fn: FunctionNode }
  | { kind: "none"; why: string };

function isFunctionNode(n: ts.Node): n is FunctionNode {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n)
  );
}

function hasExport(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

/** A `const`/`let`/function named `name` declared directly in `statements`. */
function declaredIn(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
  scope: ts.Node,
  exportedOnly: boolean
): Binding | null {
  for (const stmt of statements) {
    if (exportedOnly && !hasExport(stmt)) continue;
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === name &&
      stmt.body
    ) {
      return { kind: "function", fn: stmt };
    }
    if (!ts.isVariableStatement(stmt)) continue;
    const list = stmt.declarationList;
    for (const decl of list.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (!decl.initializer)
        return { kind: "none", why: `\`${name}\` has no initializer` };
      const init = unwrap(decl.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        return { kind: "function", fn: init };
      }
      if (list.flags & ts.NodeFlags.Const)
        return { kind: "value", expr: decl.initializer };
      if (list.flags & ts.NodeFlags.Let) return { kind: "let", decl, scope };
      return { kind: "none", why: `\`${name}\` is a \`var\`` };
    }
  }
  return null;
}

class Resolver {
  private readonly active = new Set<ts.Node>();
  /** Arguments bound to the parameters of helper functions being inlined. */
  private readonly args = new Map<
    ts.ParameterDeclaration,
    ts.Expression | undefined
  >();
  private depth = 0;

  constructor(private readonly load: ModuleLoader | undefined) {}

  /** Resolve a whole URL expression: an unknown leading part is fatal. */
  url(expr: ts.Expression): Resolved {
    return this.expr(expr, true);
  }

  /**
   * `leading` is true when nothing precedes `expr` in the URL, so an
   * unresolvable value would be (part of) the origin/path prefix and must not
   * be papered over as a `{param}`.
   */
  private expr(raw: ts.Expression, leading: boolean): Resolved {
    const e = unwrap(raw);
    if (this.active.has(e)) return unresolved("cyclic reference");
    if (this.depth >= MAX_DEPTH) return unresolved("resolution too deep");
    this.active.add(e);
    this.depth++;
    try {
      return this.expr1(e, leading);
    } finally {
      this.active.delete(e);
      this.depth--;
    }
  }

  private expr1(e: ts.Expression, leading: boolean): Resolved {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return literal(e.text);
    }
    if (isOrigin(e)) return literal("");
    if (ts.isTemplateExpression(e)) {
      let acc: Resolved = literal(e.head.text);
      for (const span of e.templateSpans) {
        acc = this.append(acc, span.expression, leading);
        if (!acc.ok) return acc;
        acc = concat(acc, literal(span.literal.text));
      }
      return acc;
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return this.append(this.expr(e.left, leading), e.right, leading);
    }
    if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return this.expr(e.left, leading);
    }
    if (ts.isConditionalExpression(e)) {
      return union([
        this.expr(e.whenTrue, leading),
        this.expr(e.whenFalse, leading),
      ]);
    }
    if (ts.isIdentifier(e)) return this.identifier(e, leading);
    if (ts.isPropertyAccessExpression(e)) return this.property(e, leading);
    if (
      ts.isNewExpression(e) &&
      tailName(e.expression) === "URL" &&
      e.arguments?.[0]
    ) {
      return this.expr(e.arguments[0], leading);
    }
    if (ts.isCallExpression(e)) return this.call(e, leading);
    return unresolved(`expression \`${snippet(e)}\``);
  }

  /** `acc` followed by the substituted expression `raw`. */
  private append(
    acc: Resolved,
    raw: ts.Expression,
    leading: boolean
  ): Resolved {
    if (!acc.ok) return acc;
    const atStart = leading && acc.texts.every((t) => t === "");
    const e = unwrap(raw);
    if (!atStart && queryName(e) !== null)
      return concat(acc, literal(QUERY_MARK));
    const part = this.expr(e, atStart);
    if (part.ok) return concat(acc, part);
    return atStart ? part : concat(acc, literal(PARAM));
  }

  private identifier(e: ts.Identifier, leading: boolean): Resolved {
    const binding = this.lookup(e.text, e);
    switch (binding.kind) {
      case "value":
        return this.expr(binding.expr, leading);
      case "let":
        return this.letValue(binding.decl, binding.scope, leading);
      case "param": {
        if (this.args.has(binding.decl)) {
          const arg = this.args.get(binding.decl) ?? binding.decl.initializer;
          if (arg) return this.expr(arg, leading);
        }
        return unresolved(`parameter \`${e.text}\``);
      }
      case "function":
        return unresolved(`\`${e.text}\` is a function, not a value`);
      case "none":
        return unresolved(binding.why);
    }
  }

  /**
   * A `let` is resolved only when the sole later writes append a query
   * string (`url += \`?${qs}\``); any other reassignment makes it unknown.
   */
  private letValue(
    decl: ts.VariableDeclaration,
    scope: ts.Node,
    leading: boolean
  ): Resolved {
    const name = (decl.name as ts.Identifier).text;
    let safe = true;
    const visit = (n: ts.Node): void => {
      if (
        ts.isBinaryExpression(n) &&
        ts.isIdentifier(n.left) &&
        n.left.text === name
      ) {
        const op = n.operatorToken.kind;
        if (op === ts.SyntaxKind.EqualsToken) safe = false;
        if (op === ts.SyntaxKind.PlusEqualsToken) {
          const rhs = unwrap(n.right);
          const head = ts.isTemplateExpression(rhs)
            ? rhs.head.text
            : ts.isStringLiteralLike(rhs)
              ? rhs.text
              : "";
          if (!/^[?&]/.test(head)) safe = false;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(scope);
    if (!safe) return unresolved(`\`let ${name}\` is reassigned`);
    return this.expr(decl.initializer as ts.Expression, leading);
  }

  private property(e: ts.PropertyAccessExpression, leading: boolean): Resolved {
    const target = unwrap(e.expression);
    const name = e.name.text;
    if (target.kind === ts.SyntaxKind.ThisKeyword) {
      const init = findThisField(name, e);
      if (init) return this.expr(init, leading);
      return unresolved(`\`this.${name}\` has no same-class initializer`);
    }
    if (name === "href") return this.expr(target, leading);
    // `ENDPOINTS.list` where `const ENDPOINTS = { list: "..." }`.
    if (ts.isIdentifier(target)) {
      const binding = this.lookup(target.text, target);
      const obj = binding.kind === "value" ? unwrap(binding.expr) : undefined;
      if (obj && ts.isObjectLiteralExpression(obj)) {
        for (const prop of obj.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
            prop.name.text === name
          ) {
            return this.expr(prop.initializer, leading);
          }
        }
      }
    }
    return unresolved(`property \`${snippet(e)}\``);
  }

  /** A same-file or imported helper that builds a URL, inlined with its arguments bound. */
  private call(e: ts.CallExpression, leading: boolean): Resolved {
    const callee = unwrap(e.expression);
    // `url.toString()` on a URL-ish value.
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "toString" &&
      e.arguments.length === 0
    ) {
      return this.expr(callee.expression, leading);
    }
    if (!ts.isIdentifier(callee)) return unresolved(`call \`${snippet(e)}\``);
    const binding = this.lookup(callee.text, callee);
    if (binding.kind !== "function")
      return unresolved(`call \`${snippet(e)}\``);
    const fn = binding.fn;
    const returns = returnExpressions(fn);
    if (returns.length === 0)
      return unresolved(`\`${callee.text}\` returns no expression`);
    const saved = fn.parameters.map(
      (p) => [p, this.args.get(p), this.args.has(p)] as const
    );
    fn.parameters.forEach((p, i) => this.args.set(p, e.arguments[i]));
    try {
      return union(returns.map((r) => this.expr(r, leading)));
    } finally {
      for (const [p, value, had] of saved) {
        if (had) this.args.set(p, value);
        else this.args.delete(p);
      }
    }
  }

  /**
   * The HTTP methods a `.fetch` options argument can carry: an object
   * literal's `method:` (a literal or a resolvable string), a same-file or
   * imported const holding one, either branch of a conditional, or a spread.
   * No `method:` anywhere is GET, as for `window.fetch`.
   */
  methods(raw: ts.Expression | undefined): Resolved {
    if (raw === undefined) return literal("GET");
    const e = unwrap(raw);
    if (this.active.has(e) || this.depth >= MAX_DEPTH)
      return unresolved("cyclic options");
    this.active.add(e);
    this.depth++;
    try {
      return this.methods1(e);
    } finally {
      this.active.delete(e);
      this.depth--;
    }
  }

  private methods1(e: ts.Expression): Resolved {
    if (ts.isObjectLiteralExpression(e)) {
      const spreads: Resolved[] = [];
      for (const prop of e.properties) {
        const name =
          (ts.isPropertyAssignment(prop) ||
            ts.isShorthandPropertyAssignment(prop)) &&
          ts.isIdentifier(prop.name)
            ? prop.name.text
            : null;
        if (name === "method") {
          const value = (
            ts.isPropertyAssignment(prop) ? prop.initializer : prop.name
          ) as ts.Expression;
          const r = this.expr(value, true);
          if (!r.ok)
            return unresolved(`method \`${snippet(value)}\` is not a literal`);
          return { ok: true, texts: r.texts.map((t) => t.toUpperCase()) };
        }
        if (ts.isSpreadAssignment(prop))
          spreads.push(this.methods(prop.expression));
      }
      // A later `method:` would have returned above; the last spread that
      // resolves wins, and spreads that carry no method say GET.
      const known = spreads.filter(
        (r) => r.ok && !(r.texts.length === 1 && r.texts[0] === "GET")
      );
      const last = known[known.length - 1];
      if (last) return last;
      if (spreads.some((r) => !r.ok))
        return spreads.find((r) => !r.ok) as Resolved;
      return literal("GET");
    }
    if (ts.isConditionalExpression(e)) {
      return union([this.methods(e.whenTrue), this.methods(e.whenFalse)]);
    }
    if (ts.isIdentifier(e)) {
      const binding = this.lookup(e.text, e);
      if (binding.kind === "value") return this.methods(binding.expr);
      if (binding.kind === "param" && this.args.has(binding.decl)) {
        return this.methods(
          this.args.get(binding.decl) ?? binding.decl.initializer
        );
      }
    }
    return unresolved(`options \`${snippet(e)}\` are not statically readable`);
  }

  /** Innermost binding of `name` visible from `from`, then the file's imports. */
  private lookup(name: string, from: ts.Node): Binding {
    for (let node: ts.Node | undefined = from; node; node = node.parent) {
      if (
        isFunctionNode(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      ) {
        for (const p of node.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === name)
            return { kind: "param", decl: p };
        }
      }
      if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
        const found = declaredIn(node.statements, name, node, false);
        if (found) return found;
      }
    }
    return this.imported(name, from.getSourceFile());
  }

  private imported(name: string, sf: ts.SourceFile): Binding {
    for (const stmt of sf.statements) {
      if (
        !ts.isImportDeclaration(stmt) ||
        !ts.isStringLiteral(stmt.moduleSpecifier) ||
        !stmt.importClause?.namedBindings ||
        !ts.isNamedImports(stmt.importClause.namedBindings)
      ) {
        continue;
      }
      for (const el of stmt.importClause.namedBindings.elements) {
        if (el.name.text !== name) continue;
        const exported = el.propertyName?.text ?? name;
        const spec = stmt.moduleSpecifier.text;
        const mod = this.load?.(sf.fileName, spec) ?? null;
        if (!mod)
          return {
            kind: "none",
            why: `\`${name}\` is imported from \`${spec}\`, not loaded`,
          };
        return (
          declaredIn(mod.statements, exported, mod, true) ?? {
            kind: "none",
            why: `\`${exported}\` is not an exported const of \`${spec}\``,
          }
        );
      }
    }
    return { kind: "none", why: `\`${name}\` is not declared in this file` };
  }
}

/** The expressions a function can return (its own returns, not nested functions'). */
function returnExpressions(fn: FunctionNode): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (isFunctionNode(n) || ts.isClassLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  fn.body.statements.forEach(visit);
  return out;
}

function concat(a: Resolved, b: Resolved): Resolved {
  if (!a.ok) return a;
  if (!b.ok) return b;
  const texts = new Set<string>();
  for (const x of a.texts) for (const y of b.texts) texts.add(x + y);
  if (texts.size > MAX_ALTERNATIVES) return unresolved("too many alternatives");
  return { ok: true, texts: [...texts] };
}

function union(parts: Resolved[]): Resolved {
  const texts = new Set<string>();
  for (const p of parts) {
    if (!p.ok) return p;
    p.texts.forEach((t) => texts.add(t));
  }
  if (texts.size > MAX_ALTERNATIVES) return unresolved("too many alternatives");
  return { ok: true, texts: [...texts] };
}

function snippet(e: ts.Node): string {
  return e.getText().replace(/\s+/g, " ").slice(0, 80);
}

/** Initializer of `this.<name>`: a field initializer, else a constructor assignment. */
function findThisField(name: string, from: ts.Node): ts.Expression | null {
  let cls: ts.Node | undefined = from;
  while (cls && !ts.isClassLike(cls)) cls = cls.parent;
  if (!cls) return null;
  const members = (cls as ts.ClassLikeDeclaration).members;
  for (const member of members) {
    if (
      ts.isPropertyDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === name &&
      member.initializer
    ) {
      return member.initializer;
    }
  }
  for (const member of members) {
    if (!ts.isConstructorDeclaration(member) || !member.body) continue;
    for (const stmt of member.body.statements) {
      if (!ts.isExpressionStatement(stmt)) continue;
      const e = stmt.expression;
      if (
        ts.isBinaryExpression(e) &&
        e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(e.left) &&
        e.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        e.left.name.text === name
      ) {
        return e.right;
      }
    }
  }
  return null;
}

/** `ApiConfig.API_BASE_URL`, `ApiConfig.getBaseUrl()`, `process.env.NEXT_PUBLIC_API_URL`. */
function isOrigin(expr: ts.Expression): boolean {
  const text = unwrap(expr).getText().replace(/\s+/g, "");
  return /^(ApiConfig\.(API_BASE_URL|getBaseUrl\(\)|getApiUrl\(\))|process\.env\.NEXT_PUBLIC_API_URL)$/.test(
    text
  );
}

/** The name a substitution is read from, when it looks like a query string. */
function queryName(e: ts.Expression): string | null {
  let target = e;
  // `params.toString()`
  if (
    ts.isCallExpression(target) &&
    ts.isPropertyAccessExpression(target.expression) &&
    target.expression.name.text === "toString" &&
    target.arguments.length === 0
  ) {
    target = target.expression.expression;
  }
  const name = tailName(target);
  return name !== null && QUERY_NAME.test(name) ? name : null;
}

/** Strip scheme+host and the query string/fragment. */
function pathOf(url: string): { path: string; wsScheme: boolean } {
  const wsScheme = /^wss?:\/\//i.test(url);
  const withoutOrigin = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return { path: withoutOrigin.split(/[?#]/)[0] ?? "", wsScheme };
}

/**
 * Every `HttpClient` call site in one source file. A URL with several
 * possible values (a conditional, a helper with several returns) yields one
 * site per distinct path.
 */
export function extractCallSites(
  file: string,
  source: string,
  load?: ModuleLoader
): CallSite[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const clients = httpClientNames(sf);
  const sites: CallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      CALL_NAMES.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const receiver = tailName(node.expression.expression);
      if (receiver !== null && clients.has(receiver)) {
        sites.push(...sitesOf(sf, file, node, node.expression.name.text, load));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function sitesOf(
  sf: ts.SourceFile,
  file: string,
  call: ts.CallExpression,
  verb: string,
  load: ModuleLoader | undefined
): CallSite[] {
  const urlArg = call.arguments[0];
  if (urlArg === undefined) return [];
  const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
  const urlText = snippet(urlArg);
  const resolver = new Resolver(load);
  const methodsResolved =
    verb === "fetch"
      ? resolver.methods(call.arguments[1])
      : literal(verb.toUpperCase());
  const methods: (string | null)[] = methodsResolved.ok
    ? methodsResolved.texts
    : [null];
  const methodWhy = methodsResolved.ok ? undefined : methodsResolved.why;
  const resolved = resolver.url(urlArg);
  const out: CallSite[] = [];
  for (const method of methods) {
    const base = { file, line, method, urlText };
    if (!resolved.ok) {
      out.push({
        ...base,
        path: null,
        wsScheme: false,
        unresolvedWhy: resolved.why,
      });
      continue;
    }
    const seen = new Set<string>();
    for (const text of resolved.texts) {
      const { path: p, wsScheme } = pathOf(text);
      if (seen.has(p)) continue;
      seen.add(p);
      if (!p.startsWith("/")) {
        out.push({
          ...base,
          path: null,
          wsScheme,
          unresolvedWhy: `resolved to a non-absolute URL \`${text}\``,
        });
      } else {
        out.push({
          ...base,
          path: p,
          wsScheme,
          ...(methodWhy ? { unresolvedWhy: methodWhy } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * A `ModuleLoader` over the real tree: `@/x` is `<srcRoot>/x`, relative
 * specifiers resolve from the importing file (whose name is relative to
 * `srcRoot`), trying `.ts`, `.tsx`, `/index.ts`, `/index.tsx`. Parsed files
 * are cached across calls.
 */
export function treeModuleLoader(srcRoot: string): ModuleLoader {
  const cache = new Map<string, ts.SourceFile | null>();
  return (fromFile, specifier) => {
    let base: string;
    if (specifier.startsWith("@/")) base = specifier.slice(2);
    else if (specifier.startsWith(".")) {
      base = path.posix.join(path.posix.dirname(fromFile), specifier);
    } else return null;
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ]) {
      if (cache.has(candidate)) {
        const hit = cache.get(candidate);
        if (hit) return hit;
        continue;
      }
      let source: string;
      try {
        source = readFileSync(path.join(srcRoot, candidate), "utf8");
      } catch {
        cache.set(candidate, null);
        continue;
      }
      const sf = ts.createSourceFile(
        candidate,
        source,
        ts.ScriptTarget.Latest,
        true,
        candidate.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      cache.set(candidate, sf);
      return sf;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MismatchReason =
  | "dead"
  | "websocket"
  | "catch-all-proxy"
  | "unresolved";

export interface SnapshotIndex {
  templates: { template: string; segments: string[]; methods: Set<string> }[];
  /**
   * Path prefixes forwarded wholesale by something the snapshot does not
   * describe route by route — today the Next.js `app/api/ui-bridge/[...path]`
   * handler. A mismatch under one is `catch-all-proxy`, not `dead`.
   */
  catchAllPrefixes: string[];
}

export function buildSnapshotIndex(
  paths: SnapshotPaths,
  catchAllPrefixes: string[] = []
): SnapshotIndex {
  return {
    templates: Object.entries(paths).map(([template, ops]) => ({
      template,
      segments: segmentsOf(template),
      methods: new Set(Object.keys(ops).map((m) => m.toUpperCase())),
    })),
    catchAllPrefixes,
  };
}

/**
 * URL prefixes of the Next.js catch-all route handlers under `app/api`
 * (`app/api/ui-bridge/[...path]/route.ts` -> `/api/ui-bridge`), given every
 * source path relative to `frontend/src`.
 */
export function nextCatchAllPrefixes(relPaths: string[]): string[] {
  const prefixes = new Set<string>();
  for (const rel of relPaths) {
    const m = /^app\/(api\/.*?)\/\[\[?\.\.\.[^\]]+\]\]?\/route\.tsx?$/.exec(
      rel
    );
    if (m) prefixes.add(`/${m[1]}`);
  }
  return [...prefixes].sort();
}

/** Segments with empty ones dropped, so a trailing slash is not significant. */
function segmentsOf(p: string): string[] {
  return p.split("/").filter((s) => s !== "");
}

const TEMPLATE_PARAM = /^\{([^}:]+)(?::[^}]+)?\}$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One client segment (may mix literals and `{param}`) against one template literal. */
function segmentMatchesLiteral(
  client: string,
  templateLiteral: string
): boolean {
  if (!client.includes(PARAM)) return client === templateLiteral;
  const pattern = client.split(PARAM).map(escapeRegex).join(".*");
  return new RegExp(`^${pattern}$`).test(templateLiteral);
}

/**
 * Whether client segments align with a template's. A literal client segment
 * never fills a template parameter: FastAPI would route `/snapshots/import`
 * to `/snapshots/{run_id}`, but that is a different endpoint from the one the
 * caller means. A client `{param}` may stand for a template literal (its
 * value is unknown) unless `strict`, which is how a verb mismatch is told
 * from a missing path: only a template aligned parameter-to-parameter is the
 * same endpoint with the wrong verb.
 */
function segmentsMatch(
  client: string[],
  template: string[],
  strict: boolean,
  ci = 0,
  ti = 0
): boolean {
  const t = template[ti];
  const c = client[ci];
  if (t === undefined) return c === undefined;
  if (c === undefined) return false;
  const param = TEMPLATE_PARAM.exec(t);
  if (param) {
    if (MULTI_SEGMENT_PARAMS.has(param[1] ?? "")) {
      for (let end = ci + 1; end <= client.length; end++) {
        if (segmentsMatch(client, template, strict, end, ti + 1)) return true;
      }
      return false;
    }
    if (!c.includes(PARAM)) return false;
    return segmentsMatch(client, template, strict, ci + 1, ti + 1);
  }
  const literalOk = strict ? c === t : segmentMatchesLiteral(c, t);
  return literalOk && segmentsMatch(client, template, strict, ci + 1, ti + 1);
}

export type SiteVerdict =
  | { ok: true; template: string }
  | {
      ok: false;
      reason: MismatchReason;
      /** `no-path`: no template matches; `verb`: the endpoint exists without this method. */
      kind: "no-path" | "verb" | "unresolved";
      detail: string;
    };

function isWebsocketPath(p: string): boolean {
  return /\/ws(\/|$)/.test(p) || /ws$/.test(p);
}

function underPrefix(p: string, prefix: string): boolean {
  return (
    p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(`${prefix}{`)
  );
}

/**
 * Classify one call site against the snapshot.
 *
 * `catch-all-proxy` is a path under `index.catchAllPrefixes`. The backend's
 * own catch-alls (`device-bridge/runner-proxy/{path}`, `screenshots/{path}`)
 * are `{x:path}` routes in the snapshot and match through
 * `MULTI_SEGMENT_PARAMS`. `/api/v1/operations/*` is NOT a catch-all:
 * `operations.py` declares every route explicitly, so an unmatched operations
 * path really 404s and is `dead`.
 */
export function checkSite(site: CallSite, index: SnapshotIndex): SiteVerdict {
  if (site.path === null || site.method === null) {
    return {
      ok: false,
      reason: "unresolved",
      kind: "unresolved",
      detail: site.unresolvedWhy ?? "unresolved",
    };
  }
  const segments = segmentsOf(site.path);
  const method = site.method;
  const candidates = index.templates.filter((t) =>
    segmentsMatch(segments, t.segments, false)
  );
  const serving = candidates.find((t) => t.methods.has(method));
  if (serving) return { ok: true, template: serving.template };

  const sameEndpoint = candidates.filter((t) =>
    segmentsMatch(segments, t.segments, true)
  );
  const kind = sameEndpoint.length > 0 ? "verb" : "no-path";
  const detail =
    kind === "verb"
      ? `${method} not served by ${sameEndpoint
          .map((t) => `${t.template} [${[...t.methods].join(",")}]`)
          .join("; ")}`
      : "no snapshot path matches";
  let reason: MismatchReason = "dead";
  if (site.wsScheme || isWebsocketPath(site.path)) reason = "websocket";
  else if (
    index.catchAllPrefixes.some((p) => underPrefix(site.path as string, p))
  ) {
    reason = "catch-all-proxy";
  }
  return { ok: false, reason, kind, detail };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineEntry {
  file: string;
  /** Upper-case method, or `?` when it could not be read. */
  method: string;
  /** Path template, or `<unresolved> <url source text>`. */
  path: string;
  reason: MismatchReason;
  kind: "no-path" | "verb" | "unresolved";
}

export function entryKey(e: BaselineEntry): string {
  return `${e.file}\t${e.method}\t${e.path}\t${e.reason}\t${e.kind}`;
}

/** One entry per mismatching `(file, method, path)`, sorted deterministically. */
export function mismatchEntries(
  sites: CallSite[],
  index: SnapshotIndex
): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>();
  for (const site of sites) {
    const verdict = checkSite(site, index);
    if (verdict.ok) continue;
    const entry: BaselineEntry = {
      file: site.file,
      method: site.method ?? "?",
      path: site.path ?? `<unresolved> ${site.urlText}`,
      reason: verdict.reason,
      kind: verdict.kind,
    };
    byKey.set(entryKey(entry), entry);
  }
  return [...byKey.values()].sort((a, b) =>
    entryKey(a) < entryKey(b) ? -1 : entryKey(a) > entryKey(b) ? 1 : 0
  );
}

/**
 * The shrink-only comparison: `added` are mismatches the baseline does not
 * hold (new drift), `stale` are baseline entries no longer produced (fixed or
 * gone — delete them). Both must be empty.
 */
export function diffAgainstBaseline(
  actual: BaselineEntry[],
  baseline: BaselineEntry[]
): { added: BaselineEntry[]; stale: BaselineEntry[] } {
  const actualKeys = new Set(actual.map(entryKey));
  const baselineKeys = new Set(baseline.map(entryKey));
  return {
    added: actual.filter((e) => !baselineKeys.has(entryKey(e))),
    stale: baseline.filter((e) => !actualKeys.has(entryKey(e))),
  };
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

/** Files the walker scans: app sources, not tests and not the generated client. */
export function isScannedFile(relPath: string): boolean {
  return (
    /\.(ts|tsx)$/.test(relPath) &&
    !relPath.endsWith(".d.ts") &&
    !/\.(test|spec)\.(ts|tsx)$/.test(relPath) &&
    !/(^|\/)__tests__\//.test(relPath) &&
    !relPath.startsWith("lib/api-client/") &&
    !relPath.startsWith("test/")
  );
}

/**
 * Every `HttpClient` call site under `srcRoot` (`frontend/src`), plus every
 * file path seen (relative, forward slashes) for `nextCatchAllPrefixes`.
 */
export function walkSourceTree(srcRoot: string): {
  sites: CallSite[];
  files: string[];
} {
  const load = treeModuleLoader(srcRoot);
  const sites: CallSite[] = [];
  const files: string[] = [];
  for (const entry of readdirSync(srcRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(srcRoot, abs).split(path.sep).join("/");
    files.push(rel);
    if (!isScannedFile(rel)) continue;
    const source = readFileSync(abs, "utf8");
    // Cheap pre-filter: no call shape, no parse.
    if (!/\.(fetch|get|post|put|patch|delete)\s*(<|\()/.test(source)) continue;
    sites.push(...extractCallSites(rel, source, load));
  }
  return { sites, files: files.sort() };
}
