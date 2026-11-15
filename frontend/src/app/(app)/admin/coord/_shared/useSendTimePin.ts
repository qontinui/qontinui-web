"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ProjectPin } from "@/services/http-client";

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
 * resolver, it resolves `undefined`.
 */
export function useSendTimePin(resolvePin: ResolvePin | undefined): ResolvePin {
  const latest = useRef(resolvePin);
  latest.current = resolvePin;
  return useCallback(() => latest.current?.(), []);
}

/**
 * A hook's first read, sent ONCE: at the first commit where `sendPin` names
 * a project. Returns whether the hook is still waiting for one, as asked
 * while it renders, so a section can say so rather than show empty data.
 *
 * A page that pins its requests reads nothing before it knows its project:
 * with one stored at mount that is the mount commit, and on a first visit it
 * is the commit where the page's project becomes known. No read is sent in,
 * or answered from, a project the page does not show. Every later read is
 * the hook's own (a Refresh, a filter, a write's read-back), sent only under
 * a pin. The pin is asked after each commit, never depended on (D10), so
 * nothing re-fires when it changes. A caller with no resolver never names a
 * project, so this reads nothing for it.
 */
export function useFirstPinnedRead(
  sendPin: ResolvePin,
  read: () => void
): boolean {
  const done = useRef(false);
  const latestRead = useRef(read);
  latestRead.current = read;
  useEffect(() => {
    if (done.current || sendPin() === undefined) return;
    done.current = true;
    latestRead.current();
  });
  return sendPin() === undefined;
}
