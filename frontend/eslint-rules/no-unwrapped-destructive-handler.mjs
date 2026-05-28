/**
 * ESLint rule: no-unwrapped-destructive-handler
 *
 * Flags JSX elements that wire a destructive-looking onClick / onSubmit
 * handler to a non-DestructiveButton element. The intent is that every
 * delete / destroy / drop / revoke / rotate / approve action sits inside
 * `<DestructiveButton>` so its synthetic-click gate
 * (`event.isTrusted === false` → blocked) protects against UI-Bridge-
 * issued or otherwise-programmatic clicks.
 *
 * Match criteria:
 *   - JSX attribute name is `onClick` or `onSubmit`.
 *   - The parent JSX element is NOT in `ALLOWED_PARENT_COMPONENTS`.
 *   - The handler identifier (or the callee of a wrapper arrow function)
 *     matches `DESTRUCTIVE_PATTERN` — destructive verbs appearing at a
 *     word boundary (camelCase or underscore-separated).
 *
 * Intentionally conservative on the verb list (delete, destroy, drop,
 * revoke, rotate, wipe, purge, approve, discard, erase, kill). Verbs
 * like `reset` / `remove` are NOT included because they're benign in
 * many UI contexts (form reset, list-item remove). Add them later if
 * the call-site sweep finds genuine destructive uses being missed.
 *
 * False positives can be silenced with an inline disable comment:
 *   // eslint-disable-next-line @qontinui-web/no-unwrapped-destructive-handler
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.4.
 */

const DESTRUCTIVE_PATTERN =
  /(?:^|[A-Z_])(?:delete|destroy|drop|revoke|rotate|wipe|purge|approve|discard|erase|kill)/i;

const ALLOWED_PARENT_COMPONENTS = new Set([
  "DestructiveButton",
  "DeleteConfirmationDialog",
  "DeleteCategoryDialog",
]);

/** Extract a handler identifier name from a JSX attribute value. */
function handlerNameFromExpression(expr) {
  if (!expr) return null;

  // <... onClick={handleDelete} />
  if (expr.type === "Identifier") {
    return expr.name;
  }

  // <... onClick={obj.handleDelete} />
  if (expr.type === "MemberExpression" && expr.property?.type === "Identifier") {
    return expr.property.name;
  }

  // <... onClick={() => handleDelete()} />
  // <... onClick={() => handleDelete(id)} />
  if (
    expr.type === "ArrowFunctionExpression" ||
    expr.type === "FunctionExpression"
  ) {
    const body = expr.body;
    // () => handleDelete()
    if (body.type === "CallExpression") {
      return calleeIdentifier(body.callee);
    }
    // () => { handleDelete(); }
    if (body.type === "BlockStatement" && body.body.length === 1) {
      const stmt = body.body[0];
      if (
        stmt.type === "ExpressionStatement" &&
        stmt.expression.type === "CallExpression"
      ) {
        return calleeIdentifier(stmt.expression.callee);
      }
    }
  }

  return null;
}

function calleeIdentifier(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Destructive onClick/onSubmit handlers must sit inside <DestructiveButton> so UI Bridge synthetic clicks are gated.",
      recommended: false,
    },
    schema: [],
    messages: {
      unwrapped:
        "Destructive handler '{{handler}}' is wired to <{{element}}>. Wrap with <DestructiveButton> so synthetic (UI Bridge / programmatic) clicks are gated.",
    },
  },

  create(context) {
    return {
      JSXAttribute(node) {
        const attrName = node.name?.name;
        if (attrName !== "onClick" && attrName !== "onSubmit") return;

        const opening = node.parent;
        if (!opening || opening.type !== "JSXOpeningElement") return;

        const elName = opening.name?.name;
        if (typeof elName !== "string") return; // skip member-expr JSX (Foo.Bar)
        if (ALLOWED_PARENT_COMPONENTS.has(elName)) return;

        const value = node.value;
        if (!value || value.type !== "JSXExpressionContainer") return;

        const handlerName = handlerNameFromExpression(value.expression);
        if (!handlerName) return;
        if (!DESTRUCTIVE_PATTERN.test(handlerName)) return;

        context.report({
          node,
          messageId: "unwrapped",
          data: { handler: handlerName, element: elName },
        });
      },
    };
  },
};

export default rule;
