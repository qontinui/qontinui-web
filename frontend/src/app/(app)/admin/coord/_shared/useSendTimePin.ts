"use client";

import { useCallback, useRef } from "react";
import type { TenantPin } from "@/services/http-client";

/**
 * Asked at the moment a request is SENT which project to pin it to, on every
 * attempt the HTTP client makes of it (`pinActiveTenant`). `undefined`: no
 * pin — the request goes in whatever project is stored when each attempt is
 * made, which is the client's ordinary behaviour.
 *
 * A page that shows one project's data passes one, so a read or write in
 * flight when another tab switches project — re-issued after a 429, replayed
 * after a token refresh, or sent once the switch is stored — is still sent in
 * the project the page shows.
 */
export type ResolvePin = () => TenantPin | undefined;

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
