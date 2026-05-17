"use client";

import React from "react";
import Link from "next/link";

import { useUserCache } from "./use-user-cache";

/**
 * Render-time resolver for the persisted `@[user_id:<uuid>]` marker.
 *
 * Cache-hit  → `<a href="/users/<uuid>">@<display></a>`
 * Cache-miss → `@?` (unstyled-ish; never throws, never blocks render)
 *
 * The cache prefill happens at `<ThreadView>` mount time via
 * `useUserCache().prime(...)`, so most renders are synchronous hits.
 */
export function MentionMarker({ userId }: { userId: string }) {
  const { get } = useUserCache();
  const user = get(userId);
  const label = user ? `@${user.display}` : "@?";
  return (
    <Link
      href={`/users/${userId}`}
      className="mention text-primary hover:underline"
      data-testid="mention-marker"
      data-user-id={userId}
    >
      {label}
    </Link>
  );
}
