/**
 * The settings cards' user-visible line for a rejection from the typed
 * `/operations` client: `HTTP <status>` (plus `: <body>` where the card has
 * always shown coord's reply), exactly what the cards composed by hand when
 * they held the `Response`. A rejection with no status (a network `TypeError`,
 * an abort) is its own message, unchanged.
 */

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

export function httpErrorText(
  err: unknown,
  { withBody = false }: { withBody?: boolean } = {}
): string {
  const status = httpStatusOf(err);
  if (status === null) {
    return err instanceof Error ? err.message : String(err);
  }
  const body = withBody ? httpBodyOf(err) : null;
  return `HTTP ${status}${body ? `: ${body}` : ""}`;
}
