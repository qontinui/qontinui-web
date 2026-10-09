"use client";

/**
 * One work unit's shipped-by attribution, read once when its detail panel
 * opens (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`
 * Phase 7). The panel mounts only while the row is expanded, so a collapsed
 * row costs no read. A failed read is UNKNOWN and carries the HTTP status, so
 * a 403 (not an operator console session) and a 404 are said apart from a
 * read that never landed.
 */

import { useEffect, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  deriveAttribution,
  statusOfError,
  type AttributionReading,
} from "./attribution";

export function attributionEndpoint(slug: string): string {
  return `/api/v1/operations/plans/${encodeURIComponent(slug)}/attribution`;
}

export function useAttribution(slug: string, enabled: boolean): AttributionReading {
  const [reading, setReading] = useState<AttributionReading>({ state: "pending" });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setReading({ state: "pending" });
    httpClient
      .get<unknown>(attributionEndpoint(slug), COORD_DASHBOARD_POLL_OPTIONS)
      .then((body) => {
        if (live) setReading(deriveAttribution(body));
      })
      .catch((e: unknown) => {
        if (!live) return;
        setReading({
          state: "failed",
          reason: e instanceof Error ? e.message : String(e),
          status: statusOfError(e),
        });
      });
    return () => {
      live = false;
    };
  }, [slug, enabled]);

  return reading;
}
