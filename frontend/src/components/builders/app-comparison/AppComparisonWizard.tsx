"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GitCompare,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSelector } from "./AppSelector";
import { ComparisonConfig } from "./ComparisonConfig";
import { SnapshotPreview } from "./SnapshotPreview";
import { ComparisonResults } from "./ComparisonResults";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type {
  DiscoveredApp,
  ComparisonResult,
  SavedSnapshot,
} from "@/lib/runner/types/exploration";

export interface ComparisonConfigState {
  refRoute: string;
  targetRoute: string;
  description: string;
  mode: "structural" | "visual" | "both";
}

type WizardMode = "live" | "saved-reference";

export function AppComparisonWizard() {
  const [step, setStep] = useState(0);
  const [wizardMode, setWizardMode] = useState<WizardMode>("live");
  const [projectId, setProjectId] = useState<string>("");
  const [referenceApp, setReferenceApp] = useState<DiscoveredApp | null>(null);
  const [targetApp, setTargetApp] = useState<DiscoveredApp | null>(null);
  const [config, setConfig] = useState<ComparisonConfigState>({
    refRoute: "",
    targetRoute: "",
    description: "",
    mode: "structural",
  });
  const [refSnapshot, setRefSnapshot] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [targetSnapshot, setTargetSnapshot] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [results, setResults] = useState<ComparisonResult | null>(null);

  // Saved snapshot state (for saved-reference mode)
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>([]);
  const [selectedSavedSnapshot, setSelectedSavedSnapshot] =
    useState<SavedSnapshot | null>(null);

  // Load saved snapshots when project filter changes
  const loadSavedSnapshots = useCallback(async () => {
    try {
      const res = await runnerApi.listComparisonSnapshots(
        projectId || undefined
      );
      setSavedSnapshots(res.snapshots);
    } catch {
      setSavedSnapshots([]);
    }
  }, [projectId]);

  useEffect(() => {
    loadSavedSnapshots();
  }, [loadSavedSnapshots]);

  // Determine wizard steps based on mode
  const STEPS =
    wizardMode === "saved-reference"
      ? [
          { label: "Reference", description: "Select saved snapshot" },
          { label: "Target App", description: "Select live target" },
          { label: "Configure", description: "Set comparison options" },
          { label: "Results", description: "View differences" },
        ]
      : [
          { label: "Select Apps", description: "Scan and choose apps" },
          { label: "Configure", description: "Set comparison options" },
          { label: "Snapshots", description: "Capture and preview" },
          { label: "Results", description: "View differences" },
        ];

  const canAdvance = () => {
    if (wizardMode === "saved-reference") {
      switch (step) {
        case 0:
          return !!selectedSavedSnapshot;
        case 1:
          return !!targetApp;
        case 2:
          return true;
        case 3:
          return true;
        default:
          return false;
      }
    }
    switch (step) {
      case 0:
        return !!referenceApp && !!targetApp;
      case 1:
        return true;
      case 2:
        return !!refSnapshot && !!targetSnapshot;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleSelectSavedSnapshot = (snap: SavedSnapshot) => {
    setSelectedSavedSnapshot(snap);
    setRefSnapshot(snap.snapshot_data);
  };

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <GitCompare className="size-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              App Comparison
            </h1>
            <p className="text-xs text-text-muted">
              Compare UI Bridge app snapshots
            </p>
          </div>
        </div>

        {/* Mode & Project selectors */}
        <div className="flex items-center gap-3">
          {/* Project filter */}
          <div className="flex items-center gap-1.5">
            <FolderOpen className="size-3.5 text-text-muted" />
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Project ID (optional)"
              className="w-36 px-2 py-1 text-[11px] bg-surface-raised border border-border-subtle rounded text-text-secondary placeholder:text-text-muted"
            />
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-md bg-surface-raised p-0.5">
            <button
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                wizardMode === "live"
                  ? "bg-cyan-600 text-white"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              onClick={() => {
                setWizardMode("live");
                setStep(0);
              }}
            >
              Live Apps
            </button>
            <button
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                wizardMode === "saved-reference"
                  ? "bg-cyan-600 text-white"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              onClick={() => {
                setWizardMode("saved-reference");
                setStep(0);
              }}
            >
              Saved Reference
            </button>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border-subtle">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`w-8 h-px ${i <= step ? "bg-cyan-500" : "bg-border-subtle"}`}
              />
            )}
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === step
                  ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                  : i < step
                    ? "bg-surface-raised text-text-secondary hover:text-text-primary cursor-pointer"
                    : "bg-surface-raised/50 text-text-muted"
              }`}
            >
              <span
                className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i === step
                    ? "bg-cyan-500 text-white"
                    : i < step
                      ? "bg-cyan-500/30 text-cyan-400"
                      : "bg-surface-canvas text-text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {wizardMode === "saved-reference" ? (
          <>
            {step === 0 && (
              <SavedSnapshotSelector
                snapshots={savedSnapshots}
                selected={selectedSavedSnapshot}
                onSelect={handleSelectSavedSnapshot}
                onRefresh={loadSavedSnapshots}
              />
            )}
            {step === 1 && (
              <AppSelector
                referenceApp={null}
                targetApp={targetApp}
                onSetReference={() => {}}
                onSetTarget={setTargetApp}
              />
            )}
            {step === 2 && (
              <ComparisonConfig config={config} onChange={setConfig} />
            )}
            {step === 3 && <ComparisonResults results={results} />}
          </>
        ) : (
          <>
            {step === 0 && (
              <AppSelector
                referenceApp={referenceApp}
                targetApp={targetApp}
                onSetReference={setReferenceApp}
                onSetTarget={setTargetApp}
              />
            )}
            {step === 1 && (
              <ComparisonConfig config={config} onChange={setConfig} />
            )}
            {step === 2 && (
              <SnapshotPreview
                referenceApp={referenceApp!}
                targetApp={targetApp!}
                config={config}
                refSnapshot={refSnapshot}
                targetSnapshot={targetSnapshot}
                onRefSnapshot={setRefSnapshot}
                onTargetSnapshot={setTargetSnapshot}
                onResults={setResults}
              />
            )}
            {step === 3 && <ComparisonResults results={results} />}
          </>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border-subtle">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="text-text-secondary"
        >
          <ChevronLeft className="size-4 mr-1" />
          Back
        </Button>

        <span className="text-xs text-text-muted">
          Step {step + 1} of {STEPS.length}
        </span>

        {/* In saved-reference mode, step 2 (Configure) auto-triggers comparison on Next */}
        <Button
          onClick={async () => {
            if (
              wizardMode === "saved-reference" &&
              step === 2 &&
              selectedSavedSnapshot &&
              targetApp
            ) {
              // Run comparison with saved reference + live target
              try {
                // Take target snapshot
                await runnerApi.uiBridgeConnect({
                  url: targetApp.url,
                  port: targetApp.port,
                });
                if (config.targetRoute) {
                  await runnerApi.uiBridgeSwitch(
                    targetApp.url + config.targetRoute
                  );
                }
                const targetSnap = await runnerApi.uiBridgeSnapshot();
                setTargetSnapshot(targetSnap);

                // Compare
                const res = await runnerApi.aiCompareSnapshots({
                  reference_snapshot: selectedSavedSnapshot.snapshot_data,
                  target_snapshot: targetSnap,
                  comparison_mode: config.mode,
                  user_prompt: config.description || undefined,
                });
                setResults(res as unknown as ComparisonResult);
              } catch {
                // Error handled silently - user sees empty results
              }
              setStep(3);
            } else {
              setStep((s) => Math.min(STEPS.length - 1, s + 1));
            }
          }}
          disabled={step === STEPS.length - 1 || !canAdvance()}
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
        >
          {wizardMode === "saved-reference" && step === 2 ? "Compare" : "Next"}
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Saved Snapshot Selector (Phase 3)
// =============================================================================

function SavedSnapshotSelector({
  snapshots,
  selected,
  onSelect,
  onRefresh,
}: {
  snapshots: SavedSnapshot[];
  selected: SavedSnapshot | null;
  onSelect: (snap: SavedSnapshot) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">
          Saved Reference Snapshots
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="text-xs text-text-muted"
        >
          Refresh
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <p className="text-sm">No saved snapshots found.</p>
          <p className="text-xs mt-1">
            Save a reference snapshot from the Live Apps comparison flow.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {snapshots.map((snap) => (
            <button
              key={snap.id}
              onClick={() => onSelect(snap)}
              className={`text-left rounded-lg border p-3 space-y-1.5 transition-colors ${
                selected?.id === snap.id
                  ? "border-cyan-500/50 bg-cyan-500/5"
                  : "border-border-subtle hover:border-border-default"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary truncate">
                  {snap.name}
                </span>
                {selected?.id === snap.id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted font-mono truncate">
                {snap.app_url}
              </div>
              <div className="flex gap-2 text-[10px] text-text-muted">
                <span>{new Date(snap.created_at).toLocaleDateString()}</span>
                {snap.project_id && <span>Project: {snap.project_id}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
