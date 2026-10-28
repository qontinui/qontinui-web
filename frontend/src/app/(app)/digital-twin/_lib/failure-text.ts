/**
 * What a failed read may say, in each mode (plan
 * `2026-10-23-console-presentation-spaces` D3.3).
 *
 * A failed read's message is the HTTP client's `<METHOD> <url> failed:
 * <status> - <body>`, and the body is upstream text — coord's refusal, a
 * proxy's error page — which can name an internal host, a tenant or a client.
 * The operator needs that text to debug, so operator mode shows it unchanged.
 * An evaluator must never see it, so presentation mode says a fixed phrase
 * and the HTTP status alone: the one part of the message that is a number the
 * page reads, not text someone upstream wrote.
 *
 * The status comes from a relay error's own field or from the console's one
 * anchored parser (`components/admin/coord/httpStatus.ts`), which never reads
 * the body.
 *
 * Pure functions (unit-tested in `failure-text.test.ts`).
 */

import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { RunnerRelayError } from "./runner-relay";

/** The HTTP status a failed read carries, or `null` when it carries none. */
export function failureStatus(error: unknown): number | null {
  if (error instanceof RunnerRelayError) return error.status ?? null;
  return httpStatusOf(error);
}

/** ` (HTTP <status>)`, or `""` for a failure that carries no status. */
export function statusSuffix(error: unknown): string {
  const status = failureStatus(error);
  return status === null ? "" : ` (HTTP ${status})`;
}

/**
 * The end of a "could not read …" sentence. For the operator, `: <message>`
 * (nothing for a throw that is not an `Error`); while presenting, the status
 * suffix and nothing else.
 */
export function failureTail(error: unknown, presenting: boolean): string {
  if (presenting) return statusSuffix(error);
  return error instanceof Error ? `: ${error.message}` : "";
}
