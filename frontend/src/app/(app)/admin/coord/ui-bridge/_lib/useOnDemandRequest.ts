"use client";

/**
 * An on-demand read's request: held for the runner it was made for, and
 * dropped when the page switches runners.
 *
 * The live snapshot and page health each drive a full `discover` of a
 * runner's window, so they run only when asked (style guide §3.10). A request
 * remembered across a switch would be a request nobody made: switch from A to
 * B and back, and A's reads would run again with no click, because their
 * queries are `staleTime: 0` and enabling one again refetches it. So the
 * request ends when the runner changes, and back on A its panels read as not
 * asked until someone asks again.
 */

import { useCallback, useState } from "react";

export interface OnDemandRequest {
  /** Whether the read was asked for, for the runner the page reads now. */
  readonly requested: boolean;
  /** Ask for it, for the runner the page reads now (nothing with no runner). */
  readonly request: () => void;
}

export function useOnDemandRequest(deviceId: string | null): OnDemandRequest {
  const [requestedFor, setRequestedFor] = useState<string | null>(null);
  const [heldFor, setHeldFor] = useState<string | null>(deviceId);
  const switched = heldFor !== deviceId;
  if (switched) {
    // React's "store information from previous renders": adjusting state
    // while rendering re-renders at once, and this render already reads the
    // request as dropped, so nothing below it is enabled for even one commit.
    setHeldFor(deviceId);
    setRequestedFor(null);
  }
  const requested =
    !switched && deviceId !== null && requestedFor === deviceId;
  const request = useCallback(() => {
    if (deviceId !== null) setRequestedFor(deviceId);
  }, [deviceId]);
  return { requested, request };
}
