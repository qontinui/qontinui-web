"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useSessionCompliance } from "../_hooks/useSessionCompliance";
import { ComplianceStateNotice } from "./ComplianceStateNotice";
import { OutstandingWorkLedger } from "./OutstandingWorkLedger";
import { SessionComplianceEnforcementPanel } from "./SessionComplianceEnforcementPanel";
import { SessionComplianceSessions } from "./SessionComplianceSessions";

/**
 * The session-compliance surface: the enforcement switch, the per-session
 * verdicts, and the outstanding-work ledger.
 *
 * It lives inside `/admin/coord/prompt-documents` rather than behind its own
 * nav entry, because what it enforces IS a prompt document — the clause the
 * check names is edited on this same page, and splitting the switch away from
 * the text it enforces is how the two drift apart.
 */
export function SessionComplianceSection() {
  const {
    config,
    versions,
    sessions,
    outstanding,
    saving,
    verdictFilter,
    changeVerdictFilter,
    nextCursor,
    setCursor,
    atFirstPage,
    saveConfig,
    reloadAll,
    featureUnavailable,
  } = useSessionCompliance();

  return (
    <div className="space-y-6" data-testid="session-compliance-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Session compliance</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Whether the sessions your runner starts are held to the closing
            report your policy requires — and what they have reported so far.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={reloadAll}
          data-testid="compliance-refresh"
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {featureUnavailable ? (
        /* Every route 404s — the feature isn't deployed on coord yet. Say that
           once, rather than repeating the same banner three times over three
           empty panels. */
        <ComplianceStateNotice
          unavailable
          degraded={null}
          error={null}
          what="settings, verdicts or outstanding work"
        />
      ) : (
        <>
          <ComplianceStateNotice
            unavailable={config.unavailable}
            degraded={config.degraded}
            error={config.error}
            what="enforcement settings"
          />

          <SessionComplianceEnforcementPanel
            config={config.data}
            loading={config.loading}
            saving={saving}
            versions={versions.data}
            versionsLoading={versions.loading}
            versionsUnavailable={versions.unavailable}
            versionsDegraded={versions.degraded}
            versionsError={versions.error}
            onSave={saveConfig}
          />

          <SessionComplianceSessions
            rows={sessions.data}
            loading={sessions.loading}
            unavailable={sessions.unavailable}
            degraded={sessions.degraded}
            error={sessions.error}
            verdictFilter={verdictFilter}
            onVerdictFilterChange={changeVerdictFilter}
            nextCursor={nextCursor}
            atFirstPage={atFirstPage}
            onCursorChange={setCursor}
          />

          <OutstandingWorkLedger
            items={outstanding.data}
            loading={outstanding.loading}
            unavailable={outstanding.unavailable}
            degraded={outstanding.degraded}
            error={outstanding.error}
          />
        </>
      )}
    </div>
  );
}
