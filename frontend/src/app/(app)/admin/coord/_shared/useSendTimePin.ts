"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  readActiveTenantId,
  type ProjectPin,
  type TenantPin,
} from "@/services/http-client";

/**
 * Asked at the moment a request is SENT which project to pin it to, on every
 * attempt the HTTP client makes of it (`pinActiveTenant`). `undefined`: no
 * pin — the request goes in whatever project is stored when each attempt is
 * made, which is the client's ordinary behaviour.
 *
 * A page that shows one project's data passes one, so a read or write in
 * flight when another tab switches project — re-issued after a 429, replayed
 * after a token refresh, or sent once the switch is stored — is still sent in
 * the project the page shows. It answers a {@link ProjectPin} or nothing,
 * never a `null` tenant: that would hold no request to the page's project and
 * would cost it its retries.
 */
export type ResolvePin = () => ProjectPin | undefined;

/**
 * The pin a READ is sent with on a page that pins its requests: the page's
 * project when `pin` names one, else the project stored as the read is sent,
 * as `usePublishAll`'s status read is. Every attempt of the read then goes in
 * that one project, so a retry cannot follow another tab's switch. With
 * nothing stored it is a pin to no project, which is not retried at all; a
 * replay after a token refresh is the one attempt that still reads the
 * selection again (`pinActiveTenant`). A write is never sent this way: with
 * no page pin it is refused.
 */
export function readPinAtSend(pin: ProjectPin | undefined): TenantPin {
  return pin ?? { tenant: readActiveTenantId() };
}

/** What a hook that pins its requests at send time is told. */
export interface SendTimePinOptions {
  /** See {@link ResolvePin}. Omitted, no request is pinned. */
  resolvePin?: ResolvePin;
}

/**
 * `resolvePin` behind ONE identity for the caller's lifetime, whatever the
 * caller passes: it is read through a ref when each request goes out, never
 * from an effect's dependencies. So a hook's mount read runs once, and no
 * callback built on the returned function changes identity because a resolver
 * did — a new resolver on every render cannot re-fire a read, and neither can
 * the pin it resolves changing (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D10). Without a
 * resolver, it resolves `undefined`. A mount read that went out with no pin
 * is re-taken once a pin appears: {@link useRetakeOnceWhenPinned}.
 */
export function useSendTimePin(resolvePin: ResolvePin | undefined): ResolvePin {
  const latest = useRef(resolvePin);
  latest.current = resolvePin;
  return useCallback(() => latest.current?.(), []);
}

/**
 * Re-takes a hook's reads ONCE, pinned, when its mount reads went out with NO
 * pin and a pin then appears.
 *
 * A page that cannot name its project when it mounts (a first visit, with
 * nothing stored) sends its mount reads with no pin of its own: pinned to the
 * project stored then (`readPinAtSend`), none on a first visit. Such a read
 * answers from whatever project the server takes for none, and its replay
 * after a token refresh from the project stored by then, possibly another
 * tab's. So the first time `sendPin` names a project, `retake` runs, once.
 * It re-sends the hook's reads, which now go out with the page's pin, and
 * must drop the answer to any read sent before them, so a late answer to an
 * earlier read cannot land over the pinned one. Mount reads that went out
 * with the page's pin are never re-taken: every attempt of them was held to
 * the page's project. Nothing else changes (D10): the mount reads still run
 * once, and no callback changes identity, because the pin is asked after
 * each commit rather than depended on.
 *
 * `sendPin` is the hook's {@link useSendTimePin} resolver. A caller that
 * passes no resolver never names a pin, so nothing is re-taken for it; one
 * whose resolver arrives only after the first commit had its mount reads sent
 * unpinned, and they are re-taken once it names a project.
 */
export function useRetakeOnceWhenPinned(
  sendPin: ResolvePin,
  retake: () => void
): void {
  // Unset until the first commit. Then: whether the reads sent at mount went
  // out with no pin and are still waiting for one.
  const waiting = useRef<boolean | undefined>(undefined);
  const latestRetake = useRef(retake);
  latestRetake.current = retake;
  useEffect(() => {
    if (waiting.current === undefined) {
      // The first commit, beside the mount reads: the pin they went out in.
      waiting.current = sendPin() === undefined;
      return;
    }
    if (!waiting.current || sendPin() === undefined) return;
    waiting.current = false;
    latestRetake.current();
  });
}
