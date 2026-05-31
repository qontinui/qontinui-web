/**
 * ESLint rule: no-unredacted-sensitive-input
 *
 * Flags JSX form-control elements (`<input>`, `<textarea>`, `<Input>`,
 * `<Textarea>`, `<PasswordInput>`) whose `id`, `name`, or `placeholder`
 * attribute matches a sensitive-keyword regex and which do NOT carry
 * `data-bridge-redact="true"` either directly OR on a JSX ancestor.
 *
 * Native `<input type="password">` is exempt — the `@qontinui/ui-bridge`
 * SDK redacts those unconditionally at snapshot time, regardless of any
 * attribute. The rule's purpose is the *non-native* sensitive surfaces
 * the SDK can't detect from the DOM alone: API key / OAuth token /
 * connection-string / OTP / 2FA-code inputs.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.6.
 *
 * False positives can be silenced with an inline disable comment that
 * carries a one-sentence rationale (e.g. a placeholder of "Search for
 * token names…" on a non-sensitive search field):
 *   // eslint-disable-next-line @qontinui-web/no-unredacted-sensitive-input
 */

// Keep in sync with the SDK's redaction guidance. Tokens / secrets / API
// keys / passwords / OTP / 2FA / card data / connection strings — the
// canonical "must not leak through a UI Bridge snapshot" list. Word-
// boundary is intentionally permissive (no `\b`) because the regex runs
// against attribute *values*, which are commonly composed identifiers
// like `openai_api_key` or `mcp.refresh_token` where boundary matching
// would miss valid hits.
export const SENSITIVE_PATTERN =
  /token|secret|api[_-]?key|password|otp|2fa|cvc|cvv|card[_-]?number|client[_-]?secret|connection[_-]?string|access[_-]?token|refresh[_-]?token/i;

const TARGET_ELEMENTS = new Set([
  "input",
  "textarea",
  "Input",
  "Textarea",
  "PasswordInput",
]);

/** Read a JSX attribute's literal string value, or null. */
function literalStringAttr(opening, attrName) {
  const attr = opening.attributes?.find(
    (a) => a.type === "JSXAttribute" && a.name?.name === attrName,
  );
  if (!attr || !attr.value) return null;
  // <... name="foo" />
  if (attr.value.type === "Literal" && typeof attr.value.value === "string") {
    return attr.value.value;
  }
  // <... name={"foo"} />
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression?.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    return attr.value.expression.value;
  }
  return null;
}

/** True iff this opening element declares `data-bridge-redact="true"`. */
function hasRedactMarker(opening) {
  const v = literalStringAttr(opening, "data-bridge-redact");
  return v === "true";
}

/** Walk JSX ancestors; true if any ancestor opening declares the marker. */
function ancestorHasRedactMarker(openingNode) {
  // openingNode.parent is the JSXElement; its parent is the enclosing
  // JSXElement (or JSXFragment / ExpressionContainer / etc). Walk up
  // until we leave JSX-element territory.
  let cursor = openingNode.parent?.parent;
  while (cursor) {
    if (cursor.type === "JSXElement") {
      if (hasRedactMarker(cursor.openingElement)) return true;
      cursor = cursor.parent;
      continue;
    }
    if (cursor.type === "JSXFragment") {
      cursor = cursor.parent;
      continue;
    }
    // Allow transparent containers (expression containers, conditionals,
    // logical wraps) to be skipped on the way up — a `<form
    // data-bridge-redact="true">{cond && <input … />}</form>` should
    // still suppress the rule.
    if (
      cursor.type === "JSXExpressionContainer" ||
      cursor.type === "ConditionalExpression" ||
      cursor.type === "LogicalExpression" ||
      cursor.type === "ArrayExpression"
    ) {
      cursor = cursor.parent;
      continue;
    }
    break;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Sensitive-named form inputs (token / secret / API key / OTP / connection string / card-number) must carry data-bridge-redact=\"true\" so UI Bridge snapshots redact their value.",
      recommended: false,
    },
    schema: [],
    messages: {
      unredacted:
        "Sensitive input <{{element}}> (matched attribute '{{attr}}'=\"{{value}}\") is missing data-bridge-redact=\"true\". Add it to this element or to a JSX ancestor (e.g. the enclosing <form>) so the UI Bridge SDK redacts the value at snapshot time.",
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        const elName = node.name?.name;
        if (typeof elName !== "string") return; // member-expr JSX (Foo.Bar)
        if (!TARGET_ELEMENTS.has(elName)) return;

        // Native <input type="password"> — SDK redacts unconditionally,
        // independent of any attribute. Don't bother authors with a
        // redundant marker.
        const typeAttr = literalStringAttr(node, "type");
        if (typeAttr === "password") return;

        // Find the first sensitive-matching attribute and report on it.
        for (const attrName of ["id", "name", "placeholder"]) {
          const value = literalStringAttr(node, attrName);
          if (typeof value !== "string") continue;
          if (!SENSITIVE_PATTERN.test(value)) continue;

          if (hasRedactMarker(node)) return;
          if (ancestorHasRedactMarker(node)) return;

          context.report({
            node,
            messageId: "unredacted",
            data: { element: elName, attr: attrName, value },
          });
          return; // one report per element
        }
      },
    };
  },
};

export default rule;
