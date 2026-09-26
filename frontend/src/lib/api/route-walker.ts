/**
 * Static walker behind `route-walker.test.ts`: finds `HttpClient` call sites
 * in TypeScript sources, resolves each one's `(method, path template)`, and
 * checks that pair against the backend OpenAPI snapshot
 * (`lib/api-client/openapi-schema.json`, which backend CI regenerates from
 * `app.openapi()` and fails on any difference) and against the Next.js route
 * handlers under `app/api`.
 *
 * A call whose URL (or method) is built from a PARAMETER of its enclosing
 * function is a wrapper (`request(path)`, `this.fetchWithAuth(url)`): it is not
 * checked itself; each call OF the wrapper is checked instead, with the
 * caller's arguments bound — one level deep. What stays unchecked is listed in
 * the header of `route-walker.test.ts`.
 *
 * Everything here except the `load*` / `walkSourceTree` / `treeModuleLoader`
 * file readers is pure — it takes source text and a `paths` object — so the
 * test can drive it on in-memory fixtures as well as on the real tree. It is
 * imported by tests only; nothing in the app bundle depends on it.
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

/** The parts of an OpenAPI snapshot the frontend tests read. */
export interface SnapshotDocument {
  paths: SnapshotPaths;
  components?: { schemas?: Record<string, unknown> };
}

/** Snapshots backend CI regenerates: the composed one and the OSS base. */
export type SnapshotFile = "openapi-schema.json" | "openapi-schema.base.json";

/**
 * One backend OpenAPI snapshot from `lib/api-client`, parsed. The single
 * loader for the frontend tests that pin against the snapshots —
 * `route-contract.test.ts` and `plan-library/types.wire.test.ts` read through
 * here too. Not cached: callers parse once and keep the result.
 */
export function loadSnapshot(
  file: SnapshotFile = "openapi-schema.json"
): SnapshotDocument {
  const abs = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../api-client",
    file
  );
  return JSON.parse(readFileSync(abs, "utf8"));
}

/** The composed backend snapshot's `paths` (or `file`'s). */
export function loadSnapshotPaths(
  file: SnapshotFile = "openapi-schema.json"
): SnapshotPaths {
  return loadSnapshot(file).paths;
}

/**
 * `(snapshot template, parameter)` for every backend route whose parameter is
 * declared with FastAPI's `:path` converter (`{repo:path}`, …) and therefore
 * spans one or more segments. OpenAPI strips the converter, so the snapshot
 * alone cannot say which `{x}` is multi-segment — and the same name can be
 * single-segment elsewhere (`/operations/prs/{owner}/{repo}/…` takes a bare
 * `repo`), so this is keyed per template, never by name alone.
 *
 * `route-walker.test.ts` recomputes this list from the `@router.<verb>`
 * decorators under `backend/app/api/v1/endpoints` composed with their
 * `include_router` prefixes in `backend/app/api/v1/api.py`, and fails on any
 * difference. A template missing here only makes the walker stricter (a false
 * `dead`), never laxer.
 */
export const MULTI_SEGMENT_TEMPLATE_PARAMS: readonly (readonly [
  string,
  string,
])[] = [
  ["/api/v1/device-bridge/runner-proxy/{path}", "path"],
  ["/api/v1/identity/responsible-users/{repo}/{pr_number}", "repo"],
  [
    "/api/v1/integration-testing/snapshots/{run_id}/screenshot/{screenshot_path}",
    "screenshot_path",
  ],
  ["/api/v1/operations/pr-merge/onboarding/repos/{repo}/restore", "repo"],
  ["/api/v1/operations/pr-merge/prs/{repo}/{pr_number}/checks", "repo"],
  ["/api/v1/operations/pr-merge/repos/{repo}/profile", "repo"],
  ["/api/v1/operations/pr-merge/{repo}/stuck-nudges", "repo"],
  ["/api/v1/projects/{project_id}/files/{file_path}", "file_path"],
  [
    "/api/v1/projects/{project_id}/files/{file_path}/custom-functions",
    "file_path",
  ],
  ["/api/v1/projects/{project_id}/images/{s3_key}", "s3_key"],
  ["/api/v1/projects/{project_id}/images/{s3_key}/refresh-url", "s3_key"],
  ["/api/v1/screenshots/{path}", "path"],
];

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

const VERB_HELPERS = ["get", "post", "put", "patch", "delete"] as const;
const CALL_NAMES: ReadonlySet<string> = new Set(["fetch", ...VERB_HELPERS]);

/** A resolved URL placeholder for a substitution the walker cannot know. */
const PARAM = "{param}";
/** A `{param}` while resolving: `PH_OPEN <id> PH_CLOSE`, see `Resolver.placeholder`. */
const PH_OPEN = "\u0001";
const PH_CLOSE = "\u0002";
const PLACEHOLDER = /\u0001(\d+)\u0002/g;

export interface CallSite {
  /** Path relative to `frontend/src`, forward slashes. */
  file: string;
  line: number;
  /** 1-based column of the call; with `line`, the site's source order. */
  column: number;
  /** Upper-case HTTP method, or `null` when it could not be read statically. */
  method: string | null;
  /**
   * The URL with origin and query string removed and every runtime
   * substitution as `{param}`; `null` when the URL could not be resolved.
   */
  path: string | null;
  /** `ws:`/`wss:` scheme on the resolved URL. */
  wsScheme: boolean;
  /**
   * The URL starts with the backend base URL (`ApiConfig.API_BASE_URL`,
   * `process.env.NEXT_PUBLIC_API_URL`, …). Production sets it, so the call
   * reaches the backend: a Next.js handler never serves it.
   */
  originBacked: boolean;
  /**
   * For each `{param}` in `path`, in order: the unbound parameter it was
   * built from, or `null` for any other run-time value. Lets a match that
   * needs a `{param}` to fill a literal segment be traced to its source.
   */
  placeholderSources?: readonly (ts.ParameterDeclaration | null)[];
  /**
   * Source text of the URL argument, whitespace-collapsed — or, for a site
   * reached through a wrapper, of the call to the wrapper.
   */
  urlText: string;
  /** Why `method` or `path` is `null`. */
  unresolvedWhy?: string;
}

/**
 * Parses the module an import specifier names, relative to the importing
 * file, or returns `null`. Supplied by the tree walk; fixtures may pass their
 * own. Without one, an imported value is `unresolved`.
 */
export type ModuleLoader = (
  fromFile: string,
  specifier: string
) => ts.SourceFile | null;

/**
 * A URL expression's possible values (branches of a conditional, returns of a
 * helper), or why it has none. `runtime` marks a value that only exists at run
 * time (a parameter, a property, a call result, a loop variable): in the
 * middle of a URL it may be widened to `{param}`. Anything else that fails —
 * a declared constant the walker could not follow — keeps the site
 * `unresolved`. `freeParam` is the unbound parameter the failure came from.
 */
type Resolved =
  | { ok: true; texts: string[] }
  | {
      ok: false;
      why: string;
      runtime: boolean;
      freeParam?: ts.ParameterDeclaration;
    };

type Failure = Extract<Resolved, { ok: false }>;

const MAX_ALTERNATIVES = 16;
const MAX_DEPTH = 24;

/** A failure of something the walker should have been able to read. */
const unresolved = (why: string): Failure => ({
  ok: false,
  why,
  runtime: false,
});
/** A failure because the value only exists at run time. */
const runtimeValue = (
  why: string,
  freeParam?: ts.ParameterDeclaration
): Failure => ({ ok: false, why, runtime: true, freeParam });
const literal = (text: string): Resolved => ({ ok: true, texts: [text] });

/**
 * A substitution named like this carries a query string or suffix, not a
 * path segment: the path is cut where it starts.
 */
const QUERY_NAME =
  /^(query|qs|querystring|queryparams|params|searchparams|search|suffix|filters?|urlparams)$/i;

/**
 * Marker for "the backend base URL" (`ApiConfig.API_BASE_URL`, …): resolved
 * to nothing, but remembered, because production sets `NEXT_PUBLIC_API_URL`
 * and such a call reaches the backend, never a Next.js handler.
 */
const ORIGIN = "\u0000";

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

/** Anything with a parameter list the walker binds arguments to. */
type ParamOwner =
  | FunctionNode
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration;

/** What a name refers to, found by walking scopes outward (then imports). */
type Binding =
  | { kind: "value"; expr: ts.Expression }
  | { kind: "let"; decl: ts.VariableDeclaration; scope: ts.Node }
  | { kind: "param"; decl: ts.ParameterDeclaration }
  | { kind: "function"; fn: FunctionNode }
  /** A loop variable, a destructured name, a `catch` variable: run-time only. */
  | { kind: "runtime"; why: string }
  | { kind: "none"; why: string };

function isFunctionNode(n: ts.Node): n is FunctionNode {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n)
  );
}

function isParamOwner(n: ts.Node): n is ParamOwner {
  return (
    isFunctionNode(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n)
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

/** Whether a binding name (identifier or destructuring pattern) binds `name`. */
function bindsName(n: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(n)) return n.text === name;
  return n.elements.some(
    (el) => !ts.isOmittedExpression(el) && bindsName(el.name, name)
  );
}

/** `useCallback(fn, deps)`: React's memoised callback is `fn` itself. */
function isMemoHook(call: ts.CallExpression, fn: ts.Node): boolean {
  return (
    tailName(call.expression) === "useCallback" && call.arguments[0] === fn
  );
}

/** The function a `const` initializer holds: `() => …`, `function …`, or `useCallback(() => …, deps)`. */
function functionValue(initializer: ts.Expression): FunctionNode | null {
  let init = unwrap(initializer);
  if (ts.isCallExpression(init) && init.arguments[0]) {
    const inner = unwrap(init.arguments[0]);
    if (isMemoHook(init, init.arguments[0])) init = inner;
  }
  return ts.isArrowFunction(init) || ts.isFunctionExpression(init)
    ? init
    : null;
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
      if (!ts.isIdentifier(decl.name)) {
        if (bindsName(decl.name, name))
          return { kind: "runtime", why: `destructured \`${name}\`` };
        continue;
      }
      if (decl.name.text !== name) continue;
      if (!decl.initializer)
        return { kind: "none", why: `\`${name}\` has no initializer` };
      const fn = functionValue(decl.initializer);
      if (fn) return { kind: "function", fn };
      if (list.flags & ts.NodeFlags.Const)
        return { kind: "value", expr: decl.initializer };
      if (list.flags & ts.NodeFlags.Let) return { kind: "let", decl, scope };
      return { kind: "none", why: `\`${name}\` is a \`var\`` };
    }
  }
  return null;
}

/** A loop or `catch` variable named `name` declared by `node` itself. */
function loopOrCatchBinding(node: ts.Node, name: string): Binding | null {
  let init: ts.Node | undefined;
  if (
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForStatement(node)
  ) {
    init = node.initializer;
  }
  if (init && ts.isVariableDeclarationList(init)) {
    if (init.declarations.some((d) => bindsName(d.name, name)))
      return { kind: "runtime", why: `loop variable \`${name}\`` };
  }
  if (
    ts.isCatchClause(node) &&
    node.variableDeclaration &&
    bindsName(node.variableDeclaration.name, name)
  ) {
    return { kind: "runtime", why: `catch variable \`${name}\`` };
  }
  return null;
}

class Resolver {
  private readonly active = new Set<ts.Node>();
  /** Arguments bound to the parameters of functions being inlined. */
  private readonly args = new Map<
    ts.ParameterDeclaration,
    ts.Expression | undefined
  >();
  private depth = 0;
  /**
   * Unbound parameters widened to `{param}` glued to a non-`/` prefix
   * (`${PREFIX}${path}`): they carry path structure, not a segment value.
   */
  readonly glued = new Set<ts.ParameterDeclaration>();
  /** Sources of the placeholders `placeholder` minted, by id. */
  readonly sources: (ts.ParameterDeclaration | null)[] = [];

  /**
   * @param strict parameters of a wrapper being resolved at one of its
   *   callers: an argument for one of them that does not resolve keeps the
   *   site `unresolved` instead of widening to `{param}`.
   */
  constructor(
    private readonly load: ModuleLoader | undefined,
    private readonly strict: ReadonlySet<ts.ParameterDeclaration> = new Set()
  ) {}

  /** Bind `fn`'s parameters to a call's arguments (a wrapper's caller). */
  bind(fn: ParamOwner, args: readonly ts.Expression[]): void {
    fn.parameters.forEach((p, i) => this.args.set(p, args[i]));
  }

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
    if (isOrigin(e)) return literal(ORIGIN);
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
      // `opts.method ?? "POST"` with `opts` bound to a literal lacking it.
      const left = unwrap(e.left);
      if (
        ts.isPropertyAccessExpression(left) &&
        this.propertyOf(left.expression, left.name.text) === "absent"
      ) {
        return this.expr(e.right, leading);
      }
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
    if (ts.isElementAccessExpression(e))
      return this.member(e, unwrap(e.expression), memberKey(e), leading);
    // `await`, arithmetic, …: computed at run time.
    return runtimeValue(`expression \`${snippet(e)}\``);
  }

  /** `acc` followed by the substituted expression `raw`. */
  private append(
    acc: Resolved,
    raw: ts.Expression,
    leading: boolean
  ): Resolved {
    if (!acc.ok) return acc;
    const atStart = leading && acc.texts.every((t) => t === "" || t === ORIGIN);
    const e = unwrap(raw);
    // A nested template or `+` is appended piece by piece, so what follows
    // `acc` is judged in its context (glued or not), not from scratch.
    if (ts.isTemplateExpression(e)) {
      let out = concat(acc, literal(e.head.text));
      for (const span of e.templateSpans) {
        out = this.append(out, span.expression, leading);
        if (!out.ok) return out;
        out = concat(out, literal(span.literal.text));
      }
      return out;
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return this.append(this.append(acc, e.left, leading), e.right, leading);
    }
    if (!atStart && queryName(e) !== null)
      return concat(acc, literal(QUERY_MARK));
    const part = this.expr(e, atStart);
    if (part.ok) return concat(acc, part);
    // Only a run-time value may stand in as `{param}`; a declared constant
    // the walker could not follow is as unknown mid-URL as at its start.
    if (atStart || !part.runtime) return part;
    // Glued to a non-`/` path prefix (not in the query string), the value
    // carries path structure, not one segment's value. Only an unbound
    // parameter may go on — it makes its function a wrapper, resolved per
    // caller (or the site unresolved when the function cannot be named).
    // Anything else (a loop variable, `this.x`, a call result) is unknown.
    if (
      acc.texts.some((t) => t !== ORIGIN && !t.endsWith("/") && !/[?#]/.test(t))
    ) {
      if (!part.freeParam)
        return unresolved(`${part.why}, glued onto a path segment`);
      this.glued.add(part.freeParam);
    }
    return concat(acc, literal(this.placeholder(part.freeParam ?? null)));
  }

  /**
   * A `{param}` placeholder that remembers the unbound parameter it stands
   * for (or none), so a match that needs it to fill a LITERAL template
   * segment can be traced back to its source (`CallSite.placeholderSources`).
   */
  private placeholder(source: ts.ParameterDeclaration | null): string {
    this.sources.push(source);
    return `${PH_OPEN}${this.sources.length - 1}${PH_CLOSE}`;
  }

  private identifier(e: ts.Identifier, leading: boolean): Resolved {
    const binding = this.lookup(e.text, e);
    switch (binding.kind) {
      case "value":
        return this.expr(binding.expr, leading);
      case "let":
        return this.letValue(binding.decl, binding.scope, leading);
      case "param":
        return this.param(binding.decl, e.text, leading);
      case "function":
        return unresolved(`\`${e.text}\` is a function, not a value`);
      case "runtime":
        return runtimeValue(binding.why);
      case "none":
        return unresolved(binding.why);
    }
  }

  private param(
    decl: ts.ParameterDeclaration,
    name: string,
    leading: boolean
  ): Resolved {
    if (!this.args.has(decl)) {
      // `action: "approve" | "reject"`: the type names every value.
      const values = literalUnion(decl.type, decl);
      if (values) return { ok: true, texts: values };
      return runtimeValue(`parameter \`${name}\``, decl);
    }
    const arg = this.args.get(decl) ?? decl.initializer;
    const strict = this.strict.has(decl);
    if (!arg) {
      return strict
        ? unresolved(`no argument for wrapper parameter \`${name}\``)
        : runtimeValue(`parameter \`${name}\` has no argument`);
    }
    // A strict argument is the caller's URL: resolve it as a URL of its own,
    // so an unknown at its start (`${q}`, `"" + q`) is fatal rather than a
    // `{param}` glued onto the wrapper's prefix. A head such as `/${id}`
    // still lets `id` widen as a segment.
    const r = this.expr(arg, strict || leading);
    if (r.ok || !strict) return r;
    // A wrapper's path-building argument that does not resolve is never a
    // pass: it is the caller's URL, not a segment value.
    return unresolved(`argument for \`${name}\`: ${r.why}`);
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
      return runtimeValue(`\`this.${name}\` has no same-class initializer`);
    }
    if (name === "href") return this.expr(target, leading);
    return this.member(e, target, name, leading);
  }

  /**
   * `target.name` (or `target[name]`; `name` null for a computed key).
   * Read off an object literal the walker can see when it can; otherwise a
   * run-time value — unless the chain's ROOT is a declared constant object
   * (a literal, `Object.freeze(...)`, an alias of one, an unfollowable
   * import): that is a URL part the walker cannot name, so `unresolved`.
   */
  private member(
    e: ts.Expression,
    target: ts.Expression,
    name: string | null,
    leading: boolean
  ): Resolved {
    // `ENDPOINTS.list` where `const ENDPOINTS = { list: "..." }`, or
    // `opts.method` where `opts` is bound to a caller's `{ method: "PUT" }`.
    const found = name === null ? null : this.propertyOf(target, name);
    // A key the walker can see is missing from a declared literal: not a
    // run-time value, a URL part it cannot name.
    if (found === "absent")
      return unresolved(`property \`${snippet(e)}\` is not set`);
    if (found) return this.expr(found, leading);
    const root = rootOf(target);
    if (ts.isIdentifier(root)) {
      const binding = this.lookup(root.text, root);
      if (binding.kind === "param" && !this.args.has(binding.decl))
        return runtimeValue(`property \`${snippet(e)}\``, binding.decl);
      // A declared object the walker could not follow (a re-export, an
      // unloaded import): its property is a constant, not a run-time value.
      if (binding.kind === "none")
        return unresolved(`property \`${snippet(e)}\`: ${binding.why}`);
      if (this.isDeclaredObject(binding, 0))
        return unresolved(
          `property \`${snippet(e)}\` of a declared constant the walker cannot read`
        );
    }
    return runtimeValue(`property \`${snippet(e)}\``);
  }

  /**
   * Whether a binding is a declared constant object rather than a run-time
   * value: a function, or a `const`/`let` initialised with an object or
   * array literal, `Object.freeze(...)`, or an alias / property of one.
   * `const sm = await load()` is run-time.
   */
  private isDeclaredObject(binding: Binding, depth: number): boolean {
    if (depth > 8) return false;
    if (binding.kind === "function") return true;
    const init =
      binding.kind === "value"
        ? binding.expr
        : binding.kind === "let"
          ? binding.decl.initializer
          : undefined;
    if (!init) return false;
    let e = unwrap(init);
    while (isObjectFreeze(e)) e = unwrap(e.arguments[0] as ts.Expression);
    if (ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e))
      return true;
    const root = rootOf(e);
    if (!ts.isIdentifier(root)) return false;
    const inner = this.lookup(root.text, root);
    return inner.kind === "none" || this.isDeclaredObject(inner, depth + 1);
  }

  /**
   * `name` read off the object literal `target` evaluates to — a `const`, an
   * alias of one, `Object.freeze(...)`, a nested literal, or the argument
   * bound to a parameter: its initializer, `"absent"` when the literal has no
   * such key (and no spread), else `null` (unknown).
   */
  private propertyOf(
    target: ts.Expression,
    name: string
  ): ts.Expression | "absent" | null {
    const obj = this.objectOf(target, 0);
    if (!obj) return null;
    for (const prop of obj.properties) {
      if (ts.isSpreadAssignment(prop)) return null;
      if (
        ts.isPropertyAssignment(prop) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
        prop.name.text === name
      ) {
        return prop.initializer;
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
        return prop.name;
      }
    }
    return "absent";
  }

  /** The object literal an expression statically evaluates to, if any. */
  private objectOf(
    raw: ts.Expression,
    depth: number
  ): ts.ObjectLiteralExpression | null {
    if (depth > 8) return null;
    const e = unwrap(raw);
    if (ts.isObjectLiteralExpression(e)) return e;
    if (isObjectFreeze(e))
      return this.objectOf(e.arguments[0] as ts.Expression, depth + 1);
    if (ts.isIdentifier(e)) {
      const binding = this.lookup(e.text, e);
      if (binding.kind === "value")
        return this.objectOf(binding.expr, depth + 1);
      if (binding.kind === "param" && this.args.has(binding.decl)) {
        const arg = this.args.get(binding.decl) ?? binding.decl.initializer;
        return arg ? this.objectOf(arg, depth + 1) : null;
      }
      return null;
    }
    const key = memberKey(e);
    if (key !== null) {
      const found = this.propertyOf(
        (e as ts.PropertyAccessExpression | ts.ElementAccessExpression)
          .expression,
        key
      );
      return found && found !== "absent"
        ? this.objectOf(found, depth + 1)
        : null;
    }
    return null;
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
    if (!ts.isIdentifier(callee)) return runtimeValue(`call \`${snippet(e)}\``);
    const binding = this.lookup(callee.text, callee);
    if (binding.kind !== "function")
      return runtimeValue(`call \`${snippet(e)}\``);
    const fn = binding.fn;
    const returns = returnExpressions(fn);
    if (returns.length === 0)
      return runtimeValue(`\`${callee.text}\` returns no expression`);
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
            return {
              ...r,
              why: `method \`${snippet(value)}\` is not a literal`,
            };
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
      const failed = spreads.find((r) => !r.ok);
      if (failed) return failed;
      return literal("GET");
    }
    if (ts.isConditionalExpression(e)) {
      return union([this.methods(e.whenTrue), this.methods(e.whenFalse)]);
    }
    if (ts.isIdentifier(e)) {
      const binding = this.lookup(e.text, e);
      if (binding.kind === "value") return this.methods(binding.expr);
      if (binding.kind === "param") {
        if (this.args.has(binding.decl)) {
          return this.methods(
            this.args.get(binding.decl) ?? binding.decl.initializer
          );
        }
        return runtimeValue(
          `options parameter \`${e.text}\` is not statically readable`,
          binding.decl
        );
      }
    }
    return unresolved(`options \`${snippet(e)}\` are not statically readable`);
  }

  /** The function a call's callee names, when it is one the walker can see. */
  calleeFunction(callee: ts.Identifier): FunctionNode | null {
    const binding = this.lookup(callee.text, callee);
    return binding.kind === "function" ? binding.fn : null;
  }

  /** Innermost binding of `name` visible from `from`, then the file's imports. */
  private lookup(name: string, from: ts.Node): Binding {
    for (let node: ts.Node | undefined = from; node; node = node.parent) {
      if (isParamOwner(node)) {
        for (const p of node.parameters) {
          if (ts.isIdentifier(p.name)) {
            if (p.name.text === name) return { kind: "param", decl: p };
          } else if (bindsName(p.name, name)) {
            return {
              kind: "runtime",
              why: `destructured parameter \`${name}\``,
            };
          }
        }
      }
      const loop = loopOrCatchBinding(node, name);
      if (loop) return loop;
      if (
        ts.isSourceFile(node) ||
        ts.isBlock(node) ||
        ts.isModuleBlock(node) ||
        ts.isCaseClause(node) ||
        ts.isDefaultClause(node)
      ) {
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

/**
 * The string values a type allows when it is a string literal or a union of
 * them — directly, or through a same-file `type X = "a" | "b"` — else null.
 */
function literalUnion(
  type: ts.TypeNode | undefined,
  from: ts.Node,
  depth = 0
): string[] | null {
  if (!type || depth > 4) return null;
  if (ts.isParenthesizedTypeNode(type))
    return literalUnion(type.type, from, depth + 1);
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))
    return [type.literal.text];
  if (ts.isUnionTypeNode(type)) {
    const out: string[] = [];
    for (const t of type.types) {
      const vs = literalUnion(t, from, depth + 1);
      if (!vs) return null;
      out.push(...vs);
    }
    return out.length <= MAX_ALTERNATIVES ? [...new Set(out)] : null;
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    for (const stmt of from.getSourceFile().statements) {
      if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name)
        return literalUnion(stmt.type, stmt, depth + 1);
    }
  }
  return null;
}

/** `Object.freeze(x)`. */
function isObjectFreeze(e: ts.Expression): e is ts.CallExpression {
  return (
    ts.isCallExpression(e) &&
    e.arguments.length === 1 &&
    unwrap(e.expression).getText() === "Object.freeze"
  );
}

/** The static key of `a.b` / `a["b"]`, else `null`. */
function memberKey(e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e)) {
    const k = unwrap(e.argumentExpression);
    return ts.isStringLiteralLike(k) ? k.text : null;
  }
  return null;
}

/** The innermost object of a member chain: `a` for `a.b["c"].d`. */
function rootOf(raw: ts.Expression): ts.Expression {
  let e = unwrap(raw);
  while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))
    e = unwrap(e.expression);
  return e;
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
function pathOf(raw: string): {
  path: string;
  wsScheme: boolean;
  originBacked: boolean;
} {
  const originBacked = raw.startsWith(ORIGIN);
  const url = raw.split(ORIGIN).join("");
  const wsScheme = /^wss?:\/\//i.test(url);
  const withoutOrigin = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return {
    path: withoutOrigin.split(/[?#]/)[0] ?? "",
    wsScheme,
    originBacked,
  };
}

function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** Where a site is reported: the call itself, or the call of its wrapper. */
interface SiteOrigin {
  file: string;
  node: ts.Node;
  urlText: string;
}

/**
 * The sites one `httpClient` call yields under `resolver`: one per method and
 * distinct path (a conditional or a multi-return helper has several).
 */
function sitesOf(
  resolver: Resolver,
  call: ts.CallExpression,
  verb: string,
  origin: SiteOrigin
): CallSite[] {
  const urlArg = call.arguments[0];
  if (urlArg === undefined) return [];
  const sf = origin.node.getSourceFile();
  const pos = sf.getLineAndCharacterOfPosition(origin.node.getStart(sf));
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
    const base = {
      file: origin.file,
      line: pos.line + 1,
      column: pos.character + 1,
      method,
      urlText: origin.urlText,
    };
    if (!resolved.ok) {
      out.push({
        ...base,
        path: null,
        wsScheme: false,
        originBacked: false,
        unresolvedWhy: resolved.why,
      });
      continue;
    }
    const seen = new Set<string>();
    for (const text of resolved.texts) {
      const { path: raw, wsScheme, originBacked } = pathOf(text);
      const placeholderSources = [...raw.matchAll(PLACEHOLDER)].map(
        (m) => resolver.sources[Number(m[1])] ?? null
      );
      const p = raw.replace(PLACEHOLDER, PARAM);
      if (seen.has(`${originBacked}${p}`)) continue;
      seen.add(`${originBacked}${p}`);
      if (!p.startsWith("/")) {
        out.push({
          ...base,
          path: null,
          wsScheme,
          originBacked,
          unresolvedWhy: `resolved to a non-absolute URL \`${text
            .split(ORIGIN)
            .join("")
            .replace(PLACEHOLDER, PARAM)}\``,
        });
      } else {
        out.push({
          ...base,
          path: p,
          wsScheme,
          originBacked,
          placeholderSources,
          ...(methodWhy ? { unresolvedWhy: methodWhy } : {}),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * A function whose `httpClient` call takes its URL (or its method) from one
 * of the function's own parameters. Its callers are checked instead of it.
 */
interface Wrapper {
  fn: ParamOwner;
  /** Name its callers use: `name(...)`, or `this.name(...)` for a member. */
  name: string;
  /** For a class member: the class whose `this.name(...)` calls it. */
  cls: ts.ClassLikeDeclaration | null;
  call: ts.CallExpression;
  verb: string;
  /** The parameters that made it a wrapper; see `Resolver` `strict`. */
  strict: ReadonlySet<ts.ParameterDeclaration>;
  /** The call's own sites, reported only if no caller of it is found. */
  fallback: CallSite[];
  callers: number;
}

/**
 * How a function is called by name: a declared function or a `const f = () =>`
 * (`name(...)`), or a class method / arrow-valued property (`this.name(...)`).
 * `null` for an anonymous function (a callback): it has no callers to follow.
 */
function callableName(
  fn: ParamOwner
): { name: string; cls: ts.ClassLikeDeclaration | null } | null {
  if (ts.isFunctionDeclaration(fn)) {
    return fn.name ? { name: fn.name.text, cls: null } : null;
  }
  if (ts.isMethodDeclaration(fn)) {
    return ts.isIdentifier(fn.name) && ts.isClassLike(fn.parent)
      ? { name: fn.name.text, cls: fn.parent }
      : null;
  }
  if (ts.isConstructorDeclaration(fn)) return null;
  let child: ts.Node = fn;
  let holder: ts.Node = fn.parent;
  while (
    ts.isParenthesizedExpression(holder) ||
    ts.isAsExpression(holder) ||
    ts.isSatisfiesExpression(holder) ||
    (ts.isCallExpression(holder) && isMemoHook(holder, child))
  ) {
    child = holder;
    holder = holder.parent;
  }
  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
    return { name: holder.name.text, cls: null };
  }
  if (
    ts.isPropertyDeclaration(holder) &&
    ts.isIdentifier(holder.name) &&
    ts.isClassLike(holder.parent)
  ) {
    return { name: holder.name.text, cls: holder.parent };
  }
  return null;
}

/**
 * The innermost enclosing function that owns one of `params` and can be
 * called by name, with the subset of `params` it owns.
 */
function wrapperOwner(
  call: ts.Node,
  params: ReadonlySet<ts.ParameterDeclaration>
): { fn: ParamOwner; owned: Set<ts.ParameterDeclaration> } | null {
  if (params.size === 0) return null;
  for (let n: ts.Node | undefined = call.parent; n; n = n.parent) {
    if (!isParamOwner(n)) continue;
    const owned = new Set(n.parameters.filter((p) => params.has(p)));
    if (owned.size > 0) return callableName(n) ? { fn: n, owned } : null;
  }
  return null;
}

/** Pass 1 over one file: direct sites, and the wrappers to resolve at their callers. */
function collectFile(
  file: string,
  sf: ts.SourceFile,
  load: ModuleLoader | undefined,
  index: SnapshotIndex | undefined
): { sites: CallSite[]; wrappers: Wrapper[] } {
  const clients = httpClientNames(sf);
  const sites: CallSite[] = [];
  const wrappers: Wrapper[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      CALL_NAMES.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const receiver = tailName(node.expression.expression);
      if (receiver !== null && clients.has(receiver)) {
        const verb = node.expression.name.text;
        const resolver = new Resolver(load);
        const own = sitesOf(resolver, node, verb, {
          file,
          node,
          urlText: snippet(node.arguments[0] as ts.Expression),
        });
        // Which parameters of an enclosing function the URL or method
        // depends on structurally (leading, glued, or the method itself).
        const triggers = new Set(resolver.glued);
        const url = resolver.url(node.arguments[0] as ts.Expression);
        if (!url.ok && url.freeParam) triggers.add(url.freeParam);
        if (verb === "fetch") {
          const m = resolver.methods(node.arguments[1]);
          if (!m.ok && m.freeParam) triggers.add(m.freeParam);
        }
        // A parameter whose `{param}` would have to fill a literal template
        // segment (`/api/v1/${resource}`) names the endpoint: resolve it per
        // caller like any other structural parameter.
        if (index) {
          for (const site of own) {
            for (const source of literalFillSources(site, index) ?? [])
              if (source) triggers.add(source);
          }
        }
        const owner = wrapperOwner(node, triggers);
        const named = owner && callableName(owner.fn);
        if (owner && named) {
          wrappers.push({
            fn: owner.fn,
            ...named,
            call: node,
            verb,
            strict: owner.owned,
            fallback: own,
            callers: 0,
          });
        } else if (triggers.size > 0) {
          // Built from a parameter of a function nothing can name (a
          // callback): its values are never seen, so a glued `{param}` would
          // pass anything under the prefix. Unresolved, as for a wrapper
          // with no caller.
          sites.push(
            ...own.map((site) => ({
              ...site,
              path: null,
              unresolvedWhy: `URL built from a parameter of an anonymous function`,
            }))
          );
        } else {
          sites.push(...own);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, wrappers };
}

function enclosingClass(n: ts.Node): ts.ClassLikeDeclaration | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isClassLike(p)) return p;
  }
  return null;
}

function isInside(node: ts.Node, ancestor: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (n === ancestor) return true;
  }
  return false;
}

/**
 * Pass 2 over one file: every reference to a wrapper. A call is resolved
 * with the caller's arguments bound. A free function is found through the
 * same scope and import lookup the resolver uses, so `request(...)` — or
 * `r(...)` after `import { request as r }` — counts only when it really names
 * that function; a member through `this.name(...)` inside its own class.
 * Every other reference the walker can see — the function passed as a value,
 * a member called on an instance (`api.fetchWithAuth(...)`) in a file that
 * imports the wrapper's module — is reported `unresolved`, never dropped.
 */
function callerSites(
  file: string,
  sf: ts.SourceFile,
  wrappers: readonly Wrapper[],
  load: ModuleLoader | undefined
): CallSite[] {
  // Local name -> free-function wrappers it may name (own name or import alias).
  const freeByName = new Map<string, Wrapper[]>();
  const memberByName = new Map<string, Wrapper[]>();
  const add = (m: Map<string, Wrapper[]>, k: string, w: Wrapper): void => {
    m.set(k, [...(m.get(k) ?? []), w]);
  };
  for (const w of wrappers) add(w.cls ? memberByName : freeByName, w.name, w);
  for (const stmt of sf.statements) {
    const named = ts.isImportDeclaration(stmt)
      ? stmt.importClause?.namedBindings
      : undefined;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const imported = el.propertyName?.text;
      if (imported === undefined) continue;
      for (const w of wrappers)
        if (!w.cls && w.name === imported) add(freeByName, el.name.text, w);
    }
  }
  // Modules this file imports, for members called on an instance.
  const importedFiles = new Set<ts.SourceFile>([sf]);
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const mod = load?.(sf.fileName, stmt.moduleSpecifier.text);
      if (mod) importedFiles.add(mod);
    }
  }

  const out: CallSite[] = [];
  const probe = new Resolver(load);
  const called = (node: ts.Node): ts.CallExpression | null => {
    let n = node;
    while (
      ts.isParenthesizedExpression(n.parent) ||
      ts.isNonNullExpression(n.parent)
    )
      n = n.parent;
    return ts.isCallExpression(n.parent) && n.parent.expression === n
      ? n.parent
      : null;
  };
  const follow = (w: Wrapper, call: ts.CallExpression): void => {
    w.callers++;
    const resolver = new Resolver(load, w.strict);
    resolver.bind(w.fn, call.arguments);
    const sites = sitesOf(resolver, w.call, w.verb, {
      file,
      node: call,
      urlText: snippet(call),
    });
    // A parameter still unbound here (the caller's own, or an outer
    // function's) glued onto a path segment carries path structure one
    // level further than the walker follows.
    out.push(
      ...(resolver.glued.size === 0
        ? sites
        : sites.map((site) => ({
            ...site,
            path: null,
            unresolvedWhy: `a parameter the walker does not follow is glued onto a path segment`,
          })))
    );
  };
  const unfollowed = (node: ts.Node, why: string): void => {
    out.push(referenceSite(file, called(node) ?? node, why));
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      freeByName.has(node.text) &&
      isReference(node)
    ) {
      const fn = probe.calleeFunction(node);
      for (const w of freeByName.get(node.text) ?? []) {
        if (w.fn !== fn || isInside(node, w.fn)) continue;
        const call = called(node);
        if (call) follow(w, call);
        else unfollowed(node, `wrapper \`${w.name}\` is used as a value`);
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      memberByName.has(node.name.text)
    ) {
      const isThis = node.expression.kind === ts.SyntaxKind.ThisKeyword;
      const cls = enclosingClass(node);
      for (const w of memberByName.get(node.name.text) ?? []) {
        if (isInside(node, w.fn)) continue;
        if (isThis && cls === w.cls) {
          const call = called(node);
          if (call) follow(w, call);
          else unfollowed(node, `wrapper \`${w.name}\` is used as a value`);
        } else if (importedFiles.has(w.fn.getSourceFile())) {
          unfollowed(
            node,
            `member wrapper \`${w.name}\` called on an instance the walker cannot follow`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** React's dependency-array hooks, by the index of their dependency argument. */
const REACT_DEPENDENCY_INDEX: ReadonlyMap<string, number> = new Map([
  ["useCallback", 1],
  ["useEffect", 1],
  ["useMemo", 1],
  ["useLayoutEffect", 1],
  ["useInsertionEffect", 1],
  ["useImperativeHandle", 2],
]);

/**
 * `[fn, id]` passed as the dependency array of one of React's own hooks:
 * React compares the dependency, it never calls it. Any other hook (a custom
 * `useParallel(opts, [fetchA])`) may call what it is given, so it is a use.
 */
function isHookDependency(id: ts.Identifier): boolean {
  const arr = id.parent;
  if (!ts.isArrayLiteralExpression(arr)) return false;
  const call = arr.parent;
  if (!ts.isCallExpression(call)) return false;
  const at = REACT_DEPENDENCY_INDEX.get(tailName(call.expression) ?? "");
  return at !== undefined && call.arguments[at] === arr;
}

/** Whether an identifier is a use of a binding (not a declaration, key or import/export name). */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (
    (ts.isFunctionDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isBindingElement(p)) &&
    p.name === id
  )
    return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (isHookDependency(id)) return false;
  return !(
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isTypeReferenceNode(p) ||
    ts.isTypeQueryNode(p)
  );
}

/** An `unresolved` site for a wrapper reference the walker cannot follow. */
function referenceSite(file: string, node: ts.Node, why: string): CallSite {
  const sf = node.getSourceFile();
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return {
    file,
    line: pos.line + 1,
    column: pos.character + 1,
    method: null,
    path: null,
    wsScheme: false,
    originBacked: false,
    urlText: snippet(node),
    unresolvedWhy: why,
  };
}

/**
 * Sites of wrappers nothing was found calling, reported as the call itself
 * and `unresolved`: the path is built from a parameter whose values the walker
 * never saw, so matching its `{param}` loosely would be a pass on no evidence.
 */
function uncalledWrapperSites(wrappers: readonly Wrapper[]): CallSite[] {
  return wrappers
    .filter((w) => w.callers === 0)
    .flatMap((w) =>
      w.fallback.map((site) => ({
        ...site,
        path: null,
        unresolvedWhy: `wrapper \`${w.name}\` has no caller the walker can follow`,
      }))
    );
}

/**
 * The `HttpClient` call sites of one source file, with wrappers defined in it
 * resolved at their same-file callers. A URL with several possible values (a
 * conditional, a helper with several returns) yields one site per distinct
 * path.
 */
export function extractCallSites(
  file: string,
  source: string,
  load?: ModuleLoader,
  index?: SnapshotIndex
): CallSite[] {
  const sf = parseSource(file, source);
  const { sites, wrappers } = collectFile(file, sf, load, index);
  sites.push(...callerSites(file, sf, wrappers, load));
  sites.push(...uncalledWrapperSites(wrappers));
  return sites;
}

/**
 * A `ModuleLoader` that can also read (`source`) and parse (`parse`) a file by
 * its own path, through the same caches.
 */
export type TreeLoader = ModuleLoader & {
  source: (relPath: string) => string | null;
  parse: (relPath: string) => ts.SourceFile | null;
};

/**
 * A `ModuleLoader` over a tree whose files `read` returns by path relative to
 * the source root (`null` when absent): `@/x` is `<root>/x`, relative
 * specifiers resolve from the importing file, trying `.ts`, `.tsx`,
 * `/index.ts`, `/index.tsx`. Parsed files are cached; `parse` reads through
 * the same cache, so a function reached by import is the same node the file's
 * own walk saw — which is how a wrapper's cross-file callers are recognised.
 */
export function moduleLoader(
  read: (relPath: string) => string | null
): TreeLoader {
  const texts = new Map<string, string | null>();
  const parsed = new Map<string, ts.SourceFile | null>();
  const source = (rel: string): string | null => {
    if (!texts.has(rel)) texts.set(rel, read(rel));
    return texts.get(rel) ?? null;
  };
  const parse = (rel: string): ts.SourceFile | null => {
    if (!parsed.has(rel)) {
      const text = source(rel);
      parsed.set(rel, text === null ? null : parseSource(rel, text));
    }
    return parsed.get(rel) ?? null;
  };
  const load = (fromFile: string, specifier: string): ts.SourceFile | null => {
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
      const hit = parse(candidate);
      if (hit) return hit;
    }
    return null;
  };
  return Object.assign(load, { source, parse });
}

/** `moduleLoader` over the files on disk under `srcRoot`. */
export function treeModuleLoader(srcRoot: string): TreeLoader {
  return moduleLoader((rel) => {
    try {
      return readFileSync(path.join(srcRoot, rel), "utf8");
    } catch {
      return null;
    }
  });
}

/** `moduleLoader` over in-memory sources keyed by path relative to the root. */
export function memoryModuleLoader(
  files: Readonly<Record<string, string>>
): TreeLoader {
  return moduleLoader((rel) => files[rel] ?? null);
}

// ---------------------------------------------------------------------------
// Next.js route handlers
// ---------------------------------------------------------------------------

const HANDLER_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/** A `frontend/src/app/api/**\/route.ts` handler, as a path template. */
export interface NextRoute {
  /** `/api/vga/state/{id}`: `[x]` is `{x}`, `[...x]` / `[[...x]]` is `{x}` too. */
  template: string;
  methods: Set<string>;
  /** Parameters from `[...x]` / `[[...x]]`: one or more segments. */
  multi: Set<string>;
  file: string;
  /**
   * An `app/api/v1/**` handler that forwards the request, cookie turned into
   * a bearer, to the IDENTICAL backend path. It serves nothing of its own —
   * the backend route still has to exist — so it is not indexed.
   * `route-walker.test.ts` checks each one really is that pass-through.
   */
  backendProxy: boolean;
}

/**
 * `app/api/v1/**` handlers that do real work themselves rather than forward
 * to the same backend path. Every other `/api/v1` handler is a
 * `backendProxy`.
 */
export const NEXT_API_V1_SERVERS: ReadonlySet<string> = new Set([
  // Reads the HttpOnly `access_token` cookie and returns it for WebSocket
  // auth; the backend has no such route.
  "app/api/v1/ws-token/route.ts",
]);

/** Whether `relPath` (relative to `frontend/src`) is a Next.js API route handler. */
export function isNextRouteFile(relPath: string): boolean {
  return /^app\/api\/(.*\/)?route\.tsx?$/.test(relPath);
}

/** The HTTP methods a route module exports (`export async function GET`, `export const POST =`, `export { h as PUT }`). */
function exportedHandlerMethods(sf: ts.SourceFile): Set<string> {
  const methods = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExport(stmt) && stmt.name) {
      if (HANDLER_METHODS.has(stmt.name.text)) methods.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt) && hasExport(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HANDLER_METHODS.has(d.name.text))
          methods.add(d.name.text);
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        if (HANDLER_METHODS.has(el.name.text)) methods.add(el.name.text);
      }
    }
  }
  return methods;
}

/**
 * Route templates of the Next.js API handlers, given each handler's path
 * relative to `frontend/src` and its source. Route groups `(x)` add no
 * segment. An optional catch-all `[[...x]]` also yields its parent path.
 */
export function nextRouteTemplates(
  routes: readonly { file: string; source: string }[]
): NextRoute[] {
  const out: NextRoute[] = [];
  for (const { file, source } of routes) {
    if (!isNextRouteFile(file)) continue;
    const methods = exportedHandlerMethods(parseSource(file, source));
    const dirs = file.split("/").slice(1, -1); // drop `app`, `route.ts`
    const segments: string[] = [];
    const multi = new Set<string>();
    let optionalAt: number | null = null;
    for (const d of dirs) {
      if (/^\(.*\)$/.test(d)) continue;
      const catchAll = /^\[(\[)?\.\.\.([^\]]+)\]\]?$/.exec(d);
      const single = /^\[([^\].]+)\]$/.exec(d);
      if (catchAll) {
        const name = catchAll[2] as string;
        if (catchAll[1]) optionalAt = segments.length;
        multi.add(name);
        segments.push(`{${name}}`);
      } else if (single) {
        segments.push(`{${single[1]}}`);
      } else {
        segments.push(d);
      }
    }
    const backendProxy =
      file.startsWith("app/api/v1/") && !NEXT_API_V1_SERVERS.has(file);
    out.push({
      template: `/${segments.join("/")}`,
      methods,
      multi,
      file,
      backendProxy,
    });
    if (optionalAt !== null) {
      out.push({
        template: `/${segments.slice(0, optionalAt).join("/")}`,
        methods,
        multi: new Set(),
        file,
        backendProxy,
      });
    }
  }
  return out.sort((a, b) => (a.template < b.template ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MismatchReason = "dead" | "websocket" | "unresolved";

interface IndexedTemplate {
  template: string;
  segments: string[];
  methods: Set<string>;
  /** Parameters of THIS template that span one or more segments. */
  multi: Set<string>;
  /** Who serves it: the FastAPI backend, or a Next.js route handler. */
  servedBy: "backend" | "next";
}

export interface SnapshotIndex {
  templates: IndexedTemplate[];
}

export function buildSnapshotIndex(
  paths: SnapshotPaths,
  opts: {
    /** `(template, param)` pairs of multi-segment backend parameters. */
    multiSegment?: readonly (readonly [string, string])[];
    nextRoutes?: readonly NextRoute[];
  } = {}
): SnapshotIndex {
  const multiSegment = opts.multiSegment ?? MULTI_SEGMENT_TEMPLATE_PARAMS;
  const multiOf = (template: string): Set<string> =>
    new Set(multiSegment.filter(([t]) => t === template).map(([, n]) => n));
  return {
    templates: [
      ...Object.entries(paths).map(([template, ops]) => ({
        template,
        segments: segmentsOf(template),
        methods: new Set(Object.keys(ops).map((m) => m.toUpperCase())),
        multi: multiOf(template),
        servedBy: "backend" as const,
      })),
      ...(opts.nextRoutes ?? [])
        .filter((r) => !r.backendProxy)
        .map((r) => ({
          template: r.template,
          segments: segmentsOf(r.template),
          methods: r.methods,
          multi: r.multi,
          servedBy: "next" as const,
        })),
    ],
  };
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
  t: IndexedTemplate,
  strict: boolean,
  ci = 0,
  ti = 0
): boolean {
  const seg = t.segments[ti];
  const c = client[ci];
  if (seg === undefined) return c === undefined;
  if (c === undefined) return false;
  const param = TEMPLATE_PARAM.exec(seg);
  if (param) {
    if (t.multi.has(param[1] ?? "")) {
      for (let end = ci + 1; end <= client.length; end++) {
        if (segmentsMatch(client, t, strict, end, ti + 1)) return true;
      }
      return false;
    }
    if (!c.includes(PARAM)) return false;
    return segmentsMatch(client, t, strict, ci + 1, ti + 1);
  }
  const literalOk = strict ? c === seg : segmentMatchesLiteral(c, seg);
  return literalOk && segmentsMatch(client, t, strict, ci + 1, ti + 1);
}

/**
 * Client segment indices where a `{param}`-carrying segment fills a LITERAL
 * template segment, for the first alignment of `client` to `t`; `null` when
 * they do not align at all.
 */
function literalFills(
  client: string[],
  t: IndexedTemplate,
  ci = 0,
  ti = 0
): number[] | null {
  const seg = t.segments[ti];
  const c = client[ci];
  if (seg === undefined) return c === undefined ? [] : null;
  if (c === undefined) return null;
  const param = TEMPLATE_PARAM.exec(seg);
  if (param) {
    if (t.multi.has(param[1] ?? "")) {
      for (let end = ci + 1; end <= client.length; end++) {
        const rest = literalFills(client, t, end, ti + 1);
        if (rest) return rest;
      }
      return null;
    }
    if (!c.includes(PARAM)) return null;
    return literalFills(client, t, ci + 1, ti + 1);
  }
  if (!segmentMatchesLiteral(c, seg)) return null;
  const rest = literalFills(client, t, ci + 1, ti + 1);
  return rest && (c === seg ? rest : [ci, ...rest]);
}

/**
 * When `site` is served ONLY through a `{param}` filling a literal template
 * segment, the sources of those placeholders (`CallSite.placeholderSources`:
 * an unbound parameter, or `null`); otherwise `null`.
 */
export function literalFillSources(
  site: CallSite,
  index: SnapshotIndex
): (ts.ParameterDeclaration | null)[] | null {
  if (site.path === null || site.method === null) return null;
  const verdict = checkSite(site, index);
  if (verdict.ok || verdict.kind !== "unresolved") return null;
  const segments = segmentsOf(site.path);
  const t = index.templates.find(
    (x) =>
      !(site.originBacked && x.servedBy === "next") &&
      x.methods.has(site.method as string) &&
      segmentsMatch(segments, x, false)
  );
  const fills = t && literalFills(segments, t);
  if (!fills) return null;
  const sources = site.placeholderSources ?? [];
  const out: (ts.ParameterDeclaration | null)[] = [];
  let seen = 0;
  segments.forEach((seg, i) => {
    const n = seg.split(PARAM).length - 1;
    if (fills.includes(i))
      for (let k = 0; k < n; k++) out.push(sources[seen + k] ?? null);
    seen += n;
  });
  return out;
}

export type SiteVerdict =
  | { ok: true; template: string; servedBy: "backend" | "next" }
  | {
      ok: false;
      reason: MismatchReason;
      /** `no-path`: no template matches; `verb`: the endpoint exists without this method. */
      kind: "no-path" | "verb" | "unresolved";
      detail: string;
    };

/** `ws` as a whole segment, or a segment ending in `-ws` / `_ws`. */
export function isWebsocketPath(p: string): boolean {
  return /(^|\/)([^/]*[-_])?ws(\/|$)/.test(p);
}

/**
 * Classify one call site against the snapshot and the Next.js handlers.
 *
 * A path served by a Next.js handler (`app/api/**\/route.ts`, catch-alls
 * included) is served — unless the URL starts with the backend base URL
 * (`originBacked`), or the handler is a `backendProxy` (not indexed). The
 * backend's own catch-alls
 * (`device-bridge/runner-proxy/{path}`, `screenshots/{path}`) are `{x:path}`
 * routes in the snapshot and match through `MULTI_SEGMENT_TEMPLATE_PARAMS`.
 * `/api/v1/operations/*` is NOT a catch-all: `operations.py` declares every
 * route explicitly, so an unmatched operations path really 404s and is `dead`.
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
  // A backend-origin call never reaches a Next.js handler.
  const reachable = index.templates.filter(
    (t) => !(site.originBacked && t.servedBy === "next")
  );
  const candidates = reachable.filter((t) => segmentsMatch(segments, t, false));
  const serving = candidates.filter((t) => t.methods.has(method));
  // Served only if some template aligns parameter-to-parameter. A `{param}`
  // standing in for a LITERAL segment (`/users/{param}/activity` against
  // `/users/me/activity`) says nothing about whether the value is `me`.
  const aligned = serving.find((t) => segmentsMatch(segments, t, true));
  if (aligned)
    return { ok: true, template: aligned.template, servedBy: aligned.servedBy };
  if (serving.length > 0) {
    return {
      ok: false,
      reason: "unresolved",
      kind: "unresolved",
      detail: `a {param} stands in for a literal segment of ${serving
        .map((t) => t.template)
        .join("; ")}`,
    };
  }

  const sameEndpoint = candidates.filter((t) =>
    segmentsMatch(segments, t, true)
  );
  const kind = sameEndpoint.length > 0 ? "verb" : "no-path";
  const detail =
    kind === "verb"
      ? `${method} not served by ${sameEndpoint
          .map((t) => `${t.template} [${[...t.methods].join(",")}]`)
          .join("; ")}`
      : "no snapshot path matches";
  const reason: MismatchReason =
    site.wsScheme || isWebsocketPath(site.path) ? "websocket" : "dead";
  return { ok: false, reason, kind, detail };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineEntry {
  file: string;
  /** Upper-case method, or `?` when it could not be read. */
  method: string;
  /**
   * Path template; for an unresolved site `<path> #<n>` (method unreadable)
   * or `<unresolved> <url source text> #<n>`, where `n` is the site's
   * occurrence among the file's unresolved sites with the same method and
   * label, in source order.
   */
  path: string;
  reason: MismatchReason;
  kind: "no-path" | "verb" | "unresolved";
}

export function entryKey(e: BaselineEntry): string {
  return `${e.file}\t${e.method}\t${e.path}\t${e.reason}\t${e.kind}`;
}

/**
 * One entry per mismatching `(file, method, path)`, sorted deterministically.
 * Resolved sites carry no line, so moving code does not churn the baseline;
 * an unresolved one (path OR method unreadable) carries an occurrence index
 * instead, so a second `fetch(url)` in a file whose first one is baselined
 * is still new.
 */
export function mismatchEntries(
  sites: CallSite[],
  index: SnapshotIndex
): BaselineEntry[] {
  const verdicts = new Map(sites.map((s) => [s, checkSite(s, index)]));
  const occurrence = unresolvedOccurrences(
    sites.filter((s) => {
      const v = verdicts.get(s);
      return v !== undefined && !v.ok && v.kind === "unresolved";
    })
  );
  const byKey = new Map<string, BaselineEntry>();
  for (const site of sites) {
    const verdict = verdicts.get(site) as SiteVerdict;
    if (verdict.ok) continue;
    const entry: BaselineEntry = {
      file: site.file,
      method: site.method ?? "?",
      path:
        verdict.kind === "unresolved"
          ? `${unresolvedLabel(site)} #${occurrence.get(site) ?? 0}`
          : (site.path as string),
      reason: verdict.reason,
      kind: verdict.kind,
    };
    byKey.set(entryKey(entry), entry);
  }
  return [...byKey.values()].sort((a, b) =>
    entryKey(a) < entryKey(b) ? -1 : entryKey(a) > entryKey(b) ? 1 : 0
  );
}

/** What an unresolved site is keyed on: its path if that resolved, else its URL source. */
function unresolvedLabel(site: CallSite): string {
  return site.path ?? `<unresolved> ${site.urlText}`;
}

/**
 * 1-based source-order index of each site whose verdict is `unresolved`
 * among its file's unresolved sites with the same method and label.
 */
function unresolvedOccurrences(sites: CallSite[]): Map<CallSite, number> {
  const groups = new Map<string, CallSite[]>();
  for (const s of sites) {
    const k = `${s.file}\t${s.method ?? "?"}\t${unresolvedLabel(s)}`;
    const g = groups.get(k) ?? [];
    g.push(s);
    groups.set(k, g);
  }
  const out = new Map<CallSite, number>();
  for (const group of groups.values()) {
    const positions = [
      ...new Set(group.map((s) => s.line * 1e6 + s.column)),
    ].sort((a, b) => a - b);
    for (const s of group)
      out.set(s, positions.indexOf(s.line * 1e6 + s.column) + 1);
  }
  return out;
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
 * The `HttpClient` call sites in `rels` (paths relative to the source root,
 * read through `loader`), with wrappers resolved at their callers anywhere in
 * `rels`. Files that fail `isScannedFile` are skipped. With `index`, a
 * parameter that would have to fill a literal segment of it also makes its
 * function a wrapper (see `literalFillSources`).
 */
export function walkSources(
  rels: readonly string[],
  loader: TreeLoader,
  index?: SnapshotIndex
): CallSite[] {
  const scanned = rels
    .filter(isScannedFile)
    .map((rel) => ({ rel, text: loader.source(rel) }))
    .filter((f): f is { rel: string; text: string } => f.text !== null)
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));

  const sites: CallSite[] = [];
  const wrappers: Wrapper[] = [];
  for (const { rel, text } of scanned) {
    // Cheap pre-filter: no call shape, no parse.
    if (!/\.(fetch|get|post|put|patch|delete)\s*(<|\()/.test(text)) continue;
    const sf = loader.parse(rel);
    if (!sf) continue;
    const found = collectFile(rel, sf, loader, index);
    sites.push(...found.sites);
    wrappers.push(...found.wrappers);
  }

  // Where references can be: a wrapper's own file; for a free function, a
  // file importing it by name (aliased or not); for a member, a file that
  // mentions `.name` (`callerSites` then keeps only files importing its
  // module). Everything else is skipped unparsed.
  const own = new Map<string, Wrapper[]>();
  const exported = new Map<string, Wrapper[]>();
  const members: Wrapper[] = [];
  for (const w of wrappers) {
    const file = w.fn.getSourceFile().fileName;
    own.set(file, [...(own.get(file) ?? []), w]);
    if (w.cls === null)
      exported.set(w.name, [...(exported.get(w.name) ?? []), w]);
    else members.push(w);
  }
  const importsOf = (text: string): Wrapper[] =>
    [...exported].flatMap(([name, ws]) =>
      text.includes(name) &&
      new RegExp(
        `import\\s*(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{[^}]*\\b${escapeRegex(name)}\\b[^}]*\\}\\s*from`
      ).test(text)
        ? ws
        : []
    );
  for (const { rel, text } of scanned) {
    const candidates = new Set([
      ...(own.get(rel) ?? []),
      ...importsOf(text),
      ...members.filter((w) => text.includes(`.${w.name}`)),
    ]);
    if (candidates.size === 0) continue;
    const sf = loader.parse(rel);
    if (sf) sites.push(...callerSites(rel, sf, [...candidates], loader));
  }
  sites.push(...uncalledWrapperSites(wrappers));
  return sites;
}

/**
 * The `HttpClient` call sites under `srcRoot` (`frontend/src`) — minus the
 * blind spots listed in `route-walker.test.ts` — plus every Next.js route
 * handler's template and the index built from them and `paths`.
 */
export function walkSourceTree(
  srcRoot: string,
  paths: SnapshotPaths
): {
  sites: CallSite[];
  nextRoutes: NextRoute[];
  index: SnapshotIndex;
} {
  const rels: string[] = [];
  for (const entry of readdirSync(srcRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    rels.push(path.relative(srcRoot, abs).split(path.sep).join("/"));
  }
  const loader = treeModuleLoader(srcRoot);
  const handlers = rels.filter(isNextRouteFile).map((file) => ({
    file,
    source: loader.parse(file)?.text ?? "",
  }));
  const nextRoutes = nextRouteTemplates(handlers);
  const index = buildSnapshotIndex(paths, { nextRoutes });
  return { sites: walkSources(rels, loader, index), nextRoutes, index };
}
