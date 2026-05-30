"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Save,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import {
  useNextStepSettings,
  type AutonomyLevel,
} from "./_hooks/useNextStepSettings";

// ---- helpers ----------------------------------------------------------------

const AUTONOMY_OPTIONS: { label: string; value: AutonomyLevel }[] = [
  { label: "Escalate", value: "always_escalate" },
  { label: "Guidance", value: "guidance_only" },
  { label: "Auto", value: "auto_decide" },
];

function resolvedFromLabel(resolvedFrom: "system" | "tenant" | "repo"): string {
  return resolvedFrom === "system" ? "Default" : "Custom";
}

function resolvedFromVariant(
  resolvedFrom: "system" | "tenant" | "repo"
): "secondary" | "outline" {
  return resolvedFrom === "system" ? "secondary" : "outline";
}

// ---- segmented control for 3-way autonomy level ----------------------------

interface AutonomySegmentProps {
  value: AutonomyLevel;
  onChange: (v: AutonomyLevel) => void;
  disabled?: boolean;
}

function AutonomySegment({ value, onChange, disabled }: AutonomySegmentProps) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {AUTONOMY_OPTIONS.map((opt, idx) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1 text-xs font-medium transition-colors focus:outline-none",
              "disabled:pointer-events-none disabled:opacity-50",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              idx > 0 ? "border-l border-border" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- page -------------------------------------------------------------------

export default function CoordinationSettingsPage() {
  const {
    settings,
    loading,
    saving,
    draft,
    hasChanges,
    canEdit,
    masterEnabled,
    setDomainLevel,
    resetDomain,
    setPrimary,
    resetAllDraft,
    save,
  } = useNextStepSettings();

  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading coordination settings...</span>
        </div>
      </div>
    );
  }

  const primaryDomain = settings?.domains.find(
    (d) => d.decision_domain === "next_step"
  );
  const primaryOn = draft["next_step"] === "auto_decide";

  return (
    <div className="p-6">
      <div className="max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold">Coordination &amp; automation</h2>
          <p className="text-sm text-muted-foreground">
            Control how coordination handles autonomous next-step work when your
            interactive session goes stale.
          </p>
        </div>

        {/* Platform master-flag banner */}
        {masterEnabled ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-background px-4 py-3">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Platform autonomous dispatch: ENABLED
              </span>{" "}
              — operator-controlled, read-only. Your settings below take effect
              when this flag is on.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-4 py-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-yellow-500 shrink-0" />
            <p className="text-xs">
              <span className="font-medium text-yellow-400">
                Platform autonomous dispatch: DISABLED by the operator.
              </span>{" "}
              <span className="text-muted-foreground">
                You can save your preferences, but autonomous next-step will not
                run until the operator re-enables it platform-wide.
              </span>
            </p>
          </div>
        )}

        {/* Read-only notice */}
        {!canEdit && (
          <div className="rounded-lg border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              You have read-only access to these settings. A coord-tenant admin
              is required to make changes.
            </p>
          </div>
        )}

        {/* Primary toggle */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Autonomous next-step</h3>
            <p className="text-xs text-muted-foreground">
              Allow coordination to start the next unit of work on your behalf
            </p>
          </div>

          <div className="rounded-lg border border-border px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  id="primary-toggle"
                  checked={primaryOn}
                  onCheckedChange={(on) => setPrimary(on)}
                  disabled={!canEdit}
                />
                <Label
                  htmlFor="primary-toggle"
                  className="text-sm leading-snug cursor-pointer"
                >
                  Allow coordination to start next-step work when my session
                  goes stale
                </Label>
              </div>
              {primaryDomain && (
                <Badge
                  variant={resolvedFromVariant(primaryDomain.resolved_from)}
                  className="shrink-0 ml-3"
                >
                  {resolvedFromLabel(primaryDomain.resolved_from)}
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground pl-0.5">
              {primaryOn ? (
                <>
                  <span className="font-medium text-foreground">On</span> — when
                  your session is stale, coordination may pick and dispatch the
                  next step (leader-gated, only while you&apos;re away).
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">Off</span> —
                  coordination only sends you a recommendation; it never starts
                  work on its own.
                </>
              )}
            </p>

            {primaryDomain &&
              primaryDomain.requires_master &&
              !masterEnabled && (
                <p className="text-xs text-yellow-500/80 pl-0.5">
                  Note: effective dispatch is also gated on the platform master
                  flag (currently off).
                </p>
              )}
          </div>
        </section>

        <div className="border-t border-border" />

        {/* Advanced disclosure */}
        <section className="space-y-3">
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
              >
                <span>Advanced: per-decision behavior</span>
                {advancedOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="pt-3 space-y-3">
              {/* Legend */}
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Escalate</span> =
                ask the operator ·{" "}
                <span className="font-medium text-foreground">Guidance</span> =
                agent decides within a frame ·{" "}
                <span className="font-medium text-foreground">Auto</span> =
                coordination decides (and, for next-step, may dispatch)
              </p>

              {/* Domain rows */}
              <div className="rounded-lg border border-border divide-y divide-border">
                {settings?.domains.map((domain) => {
                  const currentLevel =
                    draft[domain.decision_domain] ?? domain.autonomy_level;
                  const isCustom = domain.resolved_from !== "system";
                  const effectiveBlocked =
                    domain.requires_master && !masterEnabled;

                  return (
                    <div
                      key={domain.decision_domain}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      {/* Label + meta */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {domain.label}
                          </span>
                          <Badge
                            variant={resolvedFromVariant(domain.resolved_from)}
                            className="text-xs"
                          >
                            {resolvedFromLabel(domain.resolved_from)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {domain.mode}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {domain.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Effective:{" "}
                          {effectiveBlocked ? (
                            <span className="text-yellow-500/80">
                              No (master off)
                            </span>
                          ) : domain.effective ? (
                            <span className="text-green-500">Yes ✓</span>
                          ) : (
                            <span>—</span>
                          )}
                        </p>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-2 shrink-0">
                        <AutonomySegment
                          value={currentLevel}
                          onChange={(level) =>
                            setDomainLevel(domain.decision_domain, level)
                          }
                          disabled={!canEdit}
                        />
                        {isCustom && (
                          <button
                            type="button"
                            title="Reset to default"
                            disabled={!canEdit}
                            onClick={() => resetDomain(domain.decision_domain)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <div className="border-t border-border" />

        {/* Save / Reset footer */}
        <div className="flex justify-end gap-3 pb-4">
          <Button
            variant="outline"
            onClick={resetAllDraft}
            disabled={!hasChanges || saving}
            className="border-border"
          >
            Reset
          </Button>
          <Button
            onClick={save}
            disabled={!hasChanges || saving || !canEdit}
            className="bg-primary text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
