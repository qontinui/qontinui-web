/**
 * ESLint rule: no-dev-stack-fallback
 *
 * Flags a string literal naming a loopback address of the maintainers' local
 * DEVELOPMENT stack (`http://localhost:8000`, `127.0.0.1:9875`, …) when it is
 * used as a FALLBACK:
 *
 *   - the right operand of `||` or `??`      `env.X || "http://localhost:8000"`
 *   - the right side of `||=` / `??=`         `url ??= "http://localhost:8000"`
 *   - a default value (parameter or destructuring)
 *                                             `function f(base = "http://localhost:8000")`
 *
 * That is defect 5 of plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`
 * (phase A5): on the deployed site an unset variable silently pointed a
 * browser — or this server — at a dev-stack port on its own loopback, which
 * exists on the maintainers' boxes and nowhere else. PR #1550 removed every
 * such site and put the dev defaults in ONE resolver
 * (`src/lib/errors/endpoint-unresolved.ts`, mirrored by
 * `config/backend-rewrite.mjs`) under `NODE_ENV=development`. This rule is the
 * ratchet that keeps the class from regrowing: read the base through
 * `resolveEndpoint()` / `resolveServerBackendUrl()` instead, which refuse with
 * a named, actionable `EndpointUnresolvedError` when nothing is configured.
 *
 * THE PORT LIST is hard-coded here (a lint rule cannot read a sibling
 * checkout at lint time) but it is NOT a second vocabulary:
 * `VOCABULARY_PORTS` is the fleet-noun vocabulary's `dev_ports` and
 * `supervisor_dependency` classes (`qontinui-schemas/fleet-nouns.toml`, pinned
 * by `fleet-nouns.pin.toml` at the repo root), and
 * `no-dev-stack-fallback.vocabulary.test.mjs` fails unless this list equals
 * what the PINNED vocabulary's patterns match. `WEB_DEV_STACK_PORTS` are the
 * dev defaults only this app's resolver holds (they are not fleet-wide
 * vocabulary); the same test asserts they stay disjoint from it. The runner's
 * own `9876` is a PRODUCT CONSTANT (vocabulary `[[product_constant]]`) and is
 * never flagged.
 *
 * The right operand is followed through a same-file `const` string
 * (`const DEFAULT = "http://localhost:8000"; x || DEFAULT`) and through both
 * branches of a conditional (`x || (dev ? "http://localhost:8000" : y)`).
 *
 * SCOPE lives here, not in eslint.config.mjs, so it has one definition:
 * test files are out of scope (a test legitimately targets the dev stack),
 * and `RESOLVER_FILES` — the only files allowed to hold a dev default — are
 * exempt by exact path, each with its reason. There is deliberately no other
 * escape hatch in the rule; a genuine exception is an inline
 * `// eslint-disable-next-line @qontinui-web/no-dev-stack-fallback -- <reason>`.
 */

/**
 * The fleet-noun vocabulary's ports, by class id. MUST equal what the pinned
 * `fleet-nouns.toml` patterns match — asserted by
 * `no-dev-stack-fallback.vocabulary.test.mjs`, so an edit here without a
 * vocabulary (pin) change is a red, and so is a pin bump that moves a port.
 */
export const VOCABULARY_PORTS = Object.freeze({
  // backend 8000, embedding 8001, frontend 3001, Postgres 5432/5433,
  // Redis 6379, MinIO 9000.
  dev_ports: Object.freeze([3001, 5432, 5433, 6379, 8000, 8001, 9000]),
  // the dev-only supervisor.
  supervisor_dependency: Object.freeze([9875]),
});

/**
 * Dev-stack ports this app's resolver holds defaults for that are NOT in the
 * fleet vocabulary. Each is still a loopback that exists only on a dev box.
 */
export const WEB_DEV_STACK_PORTS = Object.freeze({
  3000: "a Next.js / MCP dev server's default port",
  8100: "llama-swap, the local grounding-model server (endpoint `llama_swap`)",
  9870: "coord run locally (endpoint `coord`, `config/backend-rewrite.mjs`)",
});

/**
 * The files allowed to hold a dev-stack default, by path relative to
 * `frontend/`. Exact paths, never globs: a new resolver is a reviewed edit
 * here. `no-dev-stack-fallback.test.mjs` fails if any entry stops existing.
 */
export const RESOLVER_FILES = Object.freeze({
  "src/lib/errors/endpoint-unresolved.ts":
    "THE resolver: dev defaults used only under NODE_ENV=development; unset elsewhere throws EndpointUnresolvedError.",
  "config/backend-rewrite.mjs":
    "next.config.mjs's rewrite decision; mirrors the resolver's dev defaults because a .mjs config cannot import the TS module.",
});

const HOSTS = String.raw`(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)`;

/** Every flagged port, ascending. */
export const FLAGGED_PORTS = Object.freeze(
  [
    ...VOCABULARY_PORTS.dev_ports,
    ...VOCABULARY_PORTS.supervisor_dependency,
    ...Object.keys(WEB_DEV_STACK_PORTS).map(Number),
  ].sort((a, b) => a - b),
);

/**
 * A loopback dev-stack address anywhere in a string. The port must END there
 * (`localhost:80001` and `localhost:30010` are not hits), and the host must
 * not be glued to a longer name (`notlocalhost:8000`).
 */
export const DEV_STACK_URL = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9.-])${HOSTS}:(${FLAGGED_PORTS.join("|")})(?:[^0-9]|$)`,
);

/** The flagged port in `text`, or null. */
export function devStackPortIn(text) {
  const m = DEV_STACK_URL.exec(text);
  return m ? Number(m[1]) : null;
}

/** The class a flagged port belongs to, for the message. */
export function classOfPort(port) {
  if (VOCABULARY_PORTS.supervisor_dependency.includes(port)) {
    return "fleet-noun class `supervisor_dependency` — the dev-only supervisor";
  }
  if (VOCABULARY_PORTS.dev_ports.includes(port)) {
    return "fleet-noun class `dev_ports` — the local development stack";
  }
  return `web dev-stack port — ${WEB_DEV_STACK_PORTS[port]}`;
}

/** Normalise an ESLint filename to a `frontend/`-relative posix path. */
export function frontendRelative(filename) {
  const posix = String(filename).replace(/\\/g, "/");
  const idx = posix.lastIndexOf("/frontend/");
  return idx >= 0 ? posix.slice(idx + "/frontend/".length) : posix;
}

// `tests/` and `e2e/` only at the FRONTEND ROOT: a product route may itself be
// named `tests` (`src/app/(app)/build/tests/**` is the tests UI, not a test).
const TEST_FILE = /^(?:tests|e2e)\/|(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)playwright[^/]*\.config\.[cm]?[jt]s$|(?:^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/;

/** True for a file this rule does not govern. */
export function isOutOfScope(filename) {
  const rel = frontendRelative(filename);
  return TEST_FILE.test(rel) || Object.hasOwn(RESOLVER_FILES, rel);
}

/** Peel TS wrappers that do not change the value: `x as string`, `x!`, `x satisfies T`. */
function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSTypeAssertion")
  ) {
    n = n.expression;
  }
  return n;
}

/** The literal text of a string node (a template's static parts joined), or null. */
function stringText(node) {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral") {
    // Join with a separator no URL regex can straddle: `${host}:8000` must
    // not read as a hit, but `http://localhost:8000${path}` must.
    return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join("\u0000");
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a loopback dev-stack URL as a `||` / `??` fallback or default value — resolve the base through src/lib/errors/endpoint-unresolved.ts instead.",
    },
    schema: [],
    messages: {
      devStackFallback:
        "Loopback dev-stack address `{{text}}` used as a {{context}} ({{klass}}). On a deployed build an unset setting would silently point at the visitor's (or this server's) own loopback. Resolve the base with resolveEndpoint() / resolveServerBackendUrl() from @/lib/errors/endpoint-unresolved, which refuses with a named next action when nothing is configured.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isOutOfScope(filename)) return {};

    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** A same-file `const NAME = "<string>"` the identifier resolves to, or null. */
    function constInitializer(identifier) {
      let scope = sourceCode.getScope ? sourceCode.getScope(identifier) : context.getScope();
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          const def = variable.defs[0];
          if (
            variable.defs.length === 1 &&
            def?.type === "Variable" &&
            def.parent?.kind === "const" &&
            def.node.id?.type === "Identifier" &&
            def.node.init
          ) {
            return def.node.init;
          }
          return null;
        }
        scope = scope.upper;
      }
      return null;
    }

    /**
     * The value nodes a fallback can evaluate to: the node itself, both
     * branches of a conditional, and — for an identifier — its same-file
     * `const` initializer (followed a bounded number of hops).
     */
    function candidateValues(node, depth = 0) {
      const n = unwrap(node);
      if (!n || depth > 5) return [];
      if (n.type === "ConditionalExpression") {
        return [
          ...candidateValues(n.consequent, depth + 1),
          ...candidateValues(n.alternate, depth + 1),
        ];
      }
      if (n.type === "Identifier") {
        const init = constInitializer(n);
        return init ? candidateValues(init, depth + 1) : [];
      }
      return [n];
    }

    function check(valueNode, where) {
      for (const candidate of candidateValues(valueNode)) {
        const text = stringText(candidate);
        if (text === null) continue;
        const port = devStackPortIn(text);
        if (port === null) continue;
        context.report({
          node: valueNode,
          messageId: "devStackFallback",
          data: {
            text: text.replace(/\u0000/g, "${…}"),
            context: where,
            klass: classOfPort(port),
          },
        });
        return;
      }
    }

    return {
      LogicalExpression(node) {
        if (node.operator === "||" || node.operator === "??") {
          check(node.right, `\`${node.operator}\` fallback`);
        }
      },
      AssignmentExpression(node) {
        if (node.operator === "||=" || node.operator === "??=") {
          check(node.right, `\`${node.operator}\` fallback`);
        }
      },
      AssignmentPattern(node) {
        check(node.right, "default value");
      },
    };
  },
};

export default rule;
