"use client";

/**
 * rowKeyAliases — list row keys while presenting (plan
 * `2026-10-23-console-presentation-spaces` D3.3): an opaque alias of the key
 * operator mode gives the same row, so `data-row-key` carries no id and the
 * open row stays on its record. First used by `/admin/coord/home`; shared so
 * every lens list keys its rows the same way.
 */

import { useCallback, useState } from "react";
import { usePresentationMode } from "./PresentationModeProvider";

/**
 * List row keys while presenting: an opaque alias of the key operator mode
 * gives the same row.
 *
 * `RecordList` writes a row's key to `data-row-key`, and the page's own keys
 * carry a question id, gate id, device id, repository or source id — so while
 * presenting a row is keyed by an alias instead. The key is also what
 * expansion compares, so the alias must not change which row is open: a key
 * by POSITION would keep "row 2" open when a poll removes the row above it,
 * and the detail on screen would silently become another record's. So the
 * alias is of the WHOLE operator key, index suffix included: a bijection of
 * it, assigned on first sight and never reused, so a presented row opens,
 * stays open and collapses exactly when the operator's would (D1: the mode
 * changes rendering only). Turning the mode on or off closes an open row: the
 * two modes' keys differ. One registry per mounted region, kept across polls
 * ({@link useRowKey}).
 */
export class RowKeyAliases {
  private readonly aliases = new Map<string, number>();

  /** The presented key of the row operator mode keys `operatorKey` in `list`. */
  key(list: string, operatorKey: string): string {
    const identity = `${list}\u0000${operatorKey}`;
    let n = this.aliases.get(identity);
    if (n === undefined) {
      n = this.aliases.size + 1;
      this.aliases.set(identity, n);
    }
    return `${list}:row-${n}`;
  }
}

/**
 * A list row's key in this mode: the page's own key for the operator; while
 * presenting, its alias ({@link RowKeyAliases}), so `data-row-key` carries no
 * id and the open row is the record that was opened, as it is for the
 * operator. The registry lives as long as the calling component is mounted,
 * so a row keeps its alias across polls and refreshes.
 */
export function useRowKey(): (list: string, operatorKey: string) => string {
  const { presenting } = usePresentationMode();
  const [aliases] = useState(() => new RowKeyAliases());
  return useCallback(
    (list: string, operatorKey: string) =>
      presenting ? aliases.key(list, operatorKey) : operatorKey,
    [presenting, aliases]
  );
}
