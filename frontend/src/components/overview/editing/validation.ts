/**
 * Validate a form value against the JSON Schema the SERVER serves for the
 * resource (`GET /api/v1/overview/resources` → `schemas.create|update`).
 *
 * The rules are the API's own, fetched rather than restated, so the form and
 * the API cannot disagree — the property plan
 * `2026-09-20-overview-authoring-layer` §1 asks for. This is the first check,
 * not the last: the API still validates every write, and its 422 is shown
 * when something slips past here.
 *
 * Only the keywords the served schemas use are understood. An unknown keyword
 * is ignored rather than guessed at — the server remains the authority.
 */

import type { JsonSchema } from "./api";

/**
 * The constraints of a property, with its nullable wrapper removed.
 *
 * pydantic spells an optional field `anyOf: [T, {type: "null"}]`, and a
 * bounded decimal is itself `anyOf: [number, string]` with `x-numeric` on
 * the wrapper — so an optional decimal nests one inside the other. The
 * bounds sit on the innermost non-null NUMBER (or first) branch; `x-numeric`
 * is carried down from whichever wrapper declared it.
 */
function nonNull(schema: JsonSchema): { schema: JsonSchema } {
  if (!schema.anyOf) return { schema };
  const branches = schema.anyOf.filter((b) => b.type !== "null");
  const branch =
    branches.find((b) => b.type === "number" || b.type === "integer") ??
    branches.find((b) => b.anyOf) ??
    branches[0] ??
    {};
  const inner = nonNull(branch).schema;
  return {
    schema: {
      ...inner,
      "x-numeric": inner["x-numeric"] ?? schema["x-numeric"],
    },
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The problem with `value` for one property, in a plain sentence — or null
 * when it passes. `label` is what the reader calls the field.
 */
export function checkField(
  property: JsonSchema | undefined,
  value: unknown,
  label: string
): string | null {
  if (!property) return null;
  const { schema } = nonNull(property);
  // An empty value is not this function's to judge: whether the field may
  // be left empty is the form's decision (a position may; a body may not).
  if (value === null || value === undefined || value === "") return null;
  const type = schema.type;
  if (type === "string" && typeof value === "string") {
    if (
      schema.minLength !== undefined &&
      value.trim().length < schema.minLength
    )
      return `${label} can't be empty.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return `${label} is too long (at most ${schema.maxLength.toLocaleString()} characters).`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      return `${label} isn't in the expected form.`;
    return null;
  }
  if (type === "integer" || type === "number" || schema["x-numeric"]) {
    const n = asNumber(value);
    if (n === null) return `${label} must be a number.`;
    if (type === "integer" && !Number.isInteger(n))
      return `${label} must be a whole number.`;
    if (schema.minimum !== undefined && n < schema.minimum)
      return `${label} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && n > schema.maximum)
      return `${label} must be at most ${schema.maximum}.`;
    if (schema.exclusiveMinimum !== undefined && n <= schema.exclusiveMinimum)
      return `${label} must be more than ${schema.exclusiveMinimum}.`;
    if (schema.exclusiveMaximum !== undefined && n >= schema.exclusiveMaximum)
      return `${label} must be less than ${schema.exclusiveMaximum.toLocaleString()}.`;
    return null;
  }
  return null;
}

/** Every field's problem, keyed by field name; empty when all pass. */
export function checkFields(
  schema: JsonSchema | undefined,
  values: Record<string, unknown>,
  labels: Record<string, string>
): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!schema?.properties) return problems;
  for (const [name, value] of Object.entries(values)) {
    const problem = checkField(
      schema.properties[name],
      value,
      labels[name] ?? name
    );
    if (problem) problems[name] = problem;
  }
  return problems;
}
