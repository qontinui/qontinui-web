/**
 * API-contract evaluator for Spec CI.
 *
 * Given a Playwright `APIRequestContext` (which shares the browser session's
 * auth cookies) and an `IRApiCheck` from a page spec, this module:
 *   1. Issues the HTTP request via `requestCtx.fetch()`
 *   2. Evaluates each assertion against the response
 *   3. Returns structured pass/fail results
 *
 * Operator semantics mirror `qontinui-runner/src-tauri/src/api_request/executor.rs:423`.
 * JSONPath uses a simple dot-path implementation (split on `.`, traverse object
 * keys and numeric array indices) matching `api_spec_verify.rs:86`.
 */

import type { APIRequestContext } from "@playwright/test";
import Ajv from "ajv";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Lazy-loaded schema corpus + ajv validator (loaded once per run)
// ---------------------------------------------------------------------------

let _ajv: InstanceType<typeof Ajv> | null = null;
let _corpus: Record<string, unknown> | null = null;

function getCorpus(): Record<string, unknown> {
  if (!_corpus) {
    const corpusPath = join(__dirname, "schemas.json");
    _corpus = JSON.parse(readFileSync(corpusPath, "utf-8"));
  }
  return _corpus!;
}

function getAjv(): InstanceType<typeof Ajv> {
  if (!_ajv) {
    _ajv = new Ajv({ allErrors: true, strict: false });
  }
  return _ajv;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ApiAssertionResult {
  assertionIndex: number;
  type: string;
  passed: boolean;
  reason: string | null;
  durationMs: number;
}

export interface ApiCheckResult {
  id: string;
  endpoint: string;
  actualStatus: number;
  passed: boolean;
  assertionResults: ApiAssertionResult[];
  durationMs: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Operator comparison
// ---------------------------------------------------------------------------

/**
 * Compare `actual` against `expected` using the given operator.
 * Returns `{ passed, reason }`.
 */
function compareWithOperator(
  actual: unknown,
  expected: unknown,
  operator: string,
): { passed: boolean; reason: string | null } {
  switch (operator) {
    case "equals": {
      // Deep-equal for objects/arrays, strict equal for primitives.
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      return {
        passed,
        reason: passed ? null : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      };
    }
    case "contains": {
      const actualStr = typeof actual === "string" ? actual : JSON.stringify(actual);
      const expectedStr = typeof expected === "string" ? expected : String(expected);
      const passed = actualStr.includes(expectedStr);
      return {
        passed,
        reason: passed ? null : `expected to contain ${JSON.stringify(expectedStr)}, got ${JSON.stringify(actualStr)}`,
      };
    }
    case "matches": {
      const actualStr = typeof actual === "string" ? actual : JSON.stringify(actual);
      const re = new RegExp(String(expected));
      const passed = re.test(actualStr);
      return {
        passed,
        reason: passed ? null : `expected to match /${String(expected)}/, got ${JSON.stringify(actualStr)}`,
      };
    }
    case "greater_than": {
      const passed = Number(actual) > Number(expected);
      return {
        passed,
        reason: passed ? null : `expected > ${expected}, got ${actual}`,
      };
    }
    case "less_than": {
      const passed = Number(actual) < Number(expected);
      return {
        passed,
        reason: passed ? null : `expected < ${expected}, got ${actual}`,
      };
    }
    default: {
      // Fall back to equals for unknown operators.
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      return {
        passed,
        reason: passed ? null : `unknown operator "${operator}", fallback equals: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Simple dot-path JSONPath resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-separated path against a JSON value.
 * Supports object keys and numeric array indices.
 *
 * Examples:
 *   resolveDotPath({ a: { b: [1, 2, 3] } }, "a.b.1") => 2
 *   resolveDotPath({ items: [{ name: "x" }] }, "items.0.name") => "x"
 */
function resolveDotPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (Number.isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Per-assertion evaluators
// ---------------------------------------------------------------------------

function evalStatusCode(
  status: number,
  assertion: { expected: unknown; operator?: string },
): { passed: boolean; reason: string | null } {
  const op = (assertion.operator as string) ?? "equals";
  return compareWithOperator(status, assertion.expected, op);
}

function evalJsonPath(
  body: unknown,
  assertion: { jsonPath: string; expected: unknown; operator?: string },
): { passed: boolean; reason: string | null } {
  const actual = resolveDotPath(body, assertion.jsonPath);
  if (actual === undefined) {
    return { passed: false, reason: `jsonPath "${assertion.jsonPath}" resolved to undefined` };
  }
  const op = (assertion.operator as string) ?? "equals";
  return compareWithOperator(actual, assertion.expected, op);
}

function evalHeader(
  headers: Record<string, string>,
  assertion: { headerName: string; expected: unknown; operator?: string },
): { passed: boolean; reason: string | null } {
  // Header names are case-insensitive; Playwright lowercases them.
  const actual = headers[assertion.headerName.toLowerCase()];
  if (actual === undefined) {
    return { passed: false, reason: `header "${assertion.headerName}" not present in response` };
  }
  const op = (assertion.operator as string) ?? "equals";
  return compareWithOperator(actual, assertion.expected, op);
}

function evalBodyContains(
  bodyText: string,
  assertion: { expected: unknown },
): { passed: boolean; reason: string | null } {
  const needle = typeof assertion.expected === "string" ? assertion.expected : JSON.stringify(assertion.expected);
  const passed = bodyText.includes(needle);
  return {
    passed,
    reason: passed ? null : `response body does not contain ${JSON.stringify(needle)}`,
  };
}

function evalResponseTime(
  elapsedMs: number,
  assertion: { expected: unknown; operator?: string },
): { passed: boolean; reason: string | null } {
  const op = (assertion.operator as string) ?? "less_than";
  return compareWithOperator(elapsedMs, assertion.expected, op);
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export async function evaluateApiCheck(
  requestCtx: APIRequestContext,
  baseUrl: string,
  check: {
    id: string;
    request: {
      method: string;
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    assertions: Array<Record<string, unknown>>;
  },
): Promise<ApiCheckResult> {
  const endpoint = `${check.request.method} ${check.request.path}`;
  const result: ApiCheckResult = {
    id: check.id,
    endpoint,
    actualStatus: 0,
    passed: false,
    assertionResults: [],
    durationMs: 0,
    error: null,
  };

  let responseStatus = 0;
  let responseHeaders: Record<string, string> = {};
  let responseBodyText = "";
  let responseBodyJson: unknown = undefined;
  let elapsedMs = 0;

  try {
    const url = `${baseUrl.replace(/\/$/, "")}${check.request.path}`;
    const fetchOpts: {
      method: string;
      headers?: Record<string, string>;
      data?: unknown;
    } = {
      method: check.request.method,
    };
    if (check.request.headers) {
      fetchOpts.headers = check.request.headers;
    }
    if (check.request.body !== undefined && check.request.body !== null) {
      fetchOpts.data = check.request.body;
    }

    const start = Date.now();
    const response = await requestCtx.fetch(url, fetchOpts);
    elapsedMs = Date.now() - start;

    responseStatus = response.status();
    result.actualStatus = responseStatus;

    // Extract headers (Playwright's APIResponse.headersArray returns
    // {name, value}[]; headers() returns Record<string, string> lowercased).
    responseHeaders = response.headers();

    // Read body text; parse JSON if content-type suggests it.
    responseBodyText = await response.text();
    try {
      responseBodyJson = JSON.parse(responseBodyText);
    } catch {
      // Not JSON — that's fine for body_contains / header assertions.
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.durationMs = elapsedMs || 0;
    // All assertions fail when the request itself errors.
    result.assertionResults = check.assertions.map((a, i) => ({
      assertionIndex: i,
      type: (a.type as string) ?? "unknown",
      passed: false,
      reason: `request failed: ${result.error}`,
      durationMs: 0,
    }));
    return result;
  }

  // Evaluate each assertion.
  for (let i = 0; i < check.assertions.length; i++) {
    const assertion = check.assertions[i];
    const type = (assertion.type as string) ?? "unknown";
    const aStart = Date.now();
    let evalResult: { passed: boolean; reason: string | null };

    try {
      switch (type) {
        case "status_code":
          evalResult = evalStatusCode(responseStatus, assertion as { expected: unknown; operator?: string });
          break;
        case "json_path":
          evalResult = evalJsonPath(responseBodyJson, assertion as { jsonPath: string; expected: unknown; operator?: string });
          break;
        case "header":
          evalResult = evalHeader(responseHeaders, assertion as { headerName: string; expected: unknown; operator?: string });
          break;
        case "body_contains":
          evalResult = evalBodyContains(responseBodyText, assertion as { expected: unknown });
          break;
        case "response_time":
          evalResult = evalResponseTime(elapsedMs, assertion as { expected: unknown; operator?: string });
          break;
        case "conforms_to": {
          const schemaName = (assertion as { schema: string }).schema;
          if (responseBodyJson === undefined) {
            evalResult = { passed: false, reason: "response is not valid JSON" };
            break;
          }
          const corpus = getCorpus();
          const schema = corpus[schemaName];
          if (!schema) {
            evalResult = { passed: false, reason: `schema "${schemaName}" not found in corpus` };
            break;
          }
          const ajv = getAjv();
          const validate = ajv.compile(schema as object);
          const valid = validate(responseBodyJson);
          if (!valid) {
            const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join("; ") ?? "unknown";
            evalResult = { passed: false, reason: `schema conformance failed: ${errors}` };
          } else {
            evalResult = { passed: true, reason: null };
          }
          break;
        }
        default:
          evalResult = { passed: false, reason: `unknown assertion type: ${type}` };
      }
    } catch (err) {
      evalResult = {
        passed: false,
        reason: `assertion evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    result.assertionResults.push({
      assertionIndex: i,
      type,
      passed: evalResult.passed,
      reason: evalResult.reason,
      durationMs: Date.now() - aStart,
    });
  }

  result.durationMs = elapsedMs;
  result.passed = result.assertionResults.every((r) => r.passed);
  return result;
}
