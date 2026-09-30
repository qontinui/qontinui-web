"use client";

/**
 * The two reads behind the "Can I trust 'done'?" tile and the
 * `/admin/coord/verification` drill-down, each failing on its own:
 *
 * 1. coord's metrics door (`verificationMetrics.ts` for the shape), and
 * 2. the refutation findings coord posts under `verification-refuted` — the
 *    metrics object counts refutations but does not name them, and the
 *    findings store is where each one is named and can be opened.
 *
 * A failure of (2) never blanks (1): the tile still shows the refuted COUNT
 * from the metrics door and says the list could not be read.
 *
 * Plan `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
 * Phase 5.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import {
  DEFAULT_METRICS_WINDOW,
  REFUTED_FINDING_TOPIC,
  VERIFICATION_METRICS_API,
  couldNotLookReason,
  parseVerificationMetrics,
  readLastGood,
  writeLastGood,
  type VerificationMetrics,
} from "./verificationMetrics";

const FINDINGS_API = "/api/v1/operations/coord/findings";
/** Refutations are rare by construction; one page is the window's worth. */
const REFUTED_FINDINGS_LIMIT = 100;

export type MetricsRead =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ok"; metrics: VerificationMetrics };

export interface RefutedFinding {
  finding_id: string;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  topic?: string | null;
}

export type RefutedRead =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ok"; findings: RefutedFinding[]; truncated: boolean };

export interface VerificationMetricsState {
  read: MetricsRead;
  refuted: RefutedRead;
  /** `generated_at` of the last non-degraded answer this browser saw. */
  lastGood: string | null;
  reload: () => Promise<void>;
}

export function useVerificationMetrics(
  tenantId: string | null,
  /** Hold every read while the project selection is not settled. */
  hold: boolean,
  windowParam: string = DEFAULT_METRICS_WINDOW
): VerificationMetricsState {
  const [read, setRead] = useState<MetricsRead>({ status: "loading" });
  const [refuted, setRefuted] = useState<RefutedRead>({ status: "loading" });
  const [lastGood, setLastGood] = useState<string | null>(null);
  // A later read supersedes an earlier one still in flight (tenant or window
  // switched mid-read): only the newest may write.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    setRead({ status: "loading" });
    setRefuted({ status: "loading" });
    setLastGood(readLastGood(tenantId));

    const metricsP = httpClient
      .get<unknown>(
        `${VERIFICATION_METRICS_API}?window=${encodeURIComponent(windowParam)}`
      )
      .then((raw) => {
        const metrics = parseVerificationMetrics(raw);
        if (gen !== generation.current) return;
        if (!metrics.degraded) {
          writeLastGood(tenantId, metrics.generated_at);
          setLastGood(metrics.generated_at);
        }
        setRead({ status: "ok", metrics });
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return;
        setRead({ status: "error", reason: couldNotLookReason(err) });
      });

    const qs = new URLSearchParams({
      topic: REFUTED_FINDING_TOPIC,
      limit: String(REFUTED_FINDINGS_LIMIT),
    });
    const refutedP = httpClient
      .get<{
        findings?: RefutedFinding[] | null;
        unavailable?: string | null;
        truncated?: boolean | null;
      }>(`${FINDINGS_API}?${qs.toString()}`)
      .then((body) => {
        if (gen !== generation.current) return;
        if (body.unavailable || !Array.isArray(body.findings)) {
          setRefuted({
            status: "error",
            reason:
              body.unavailable ?? "the findings store answered without a list",
          });
          return;
        }
        setRefuted({
          status: "ok",
          findings: body.findings,
          truncated: body.truncated === true,
        });
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return;
        setRefuted({ status: "error", reason: couldNotLookReason(err) });
      });

    await Promise.all([metricsP, refutedP]);
  }, [tenantId, windowParam]);

  useEffect(() => {
    if (hold) return;
    void reload();
  }, [hold, reload]);

  return { read, refuted, lastGood, reload };
}
