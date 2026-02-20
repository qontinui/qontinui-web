"use client";

import { useState } from "react";
import { GitCompare, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSelector } from "./AppSelector";
import { ComparisonConfig } from "./ComparisonConfig";
import { SnapshotPreview } from "./SnapshotPreview";
import { ComparisonResults } from "./ComparisonResults";
import type {
  DiscoveredApp,
  ComparisonResult,
} from "@/lib/runner/types/exploration";

const STEPS = [
  { label: "Select Apps", description: "Scan and choose apps" },
  { label: "Configure", description: "Set comparison options" },
  { label: "Snapshots", description: "Capture and preview" },
  { label: "Results", description: "View differences" },
];

export interface ComparisonConfigState {
  refRoute: string;
  targetRoute: string;
  description: string;
  mode: "structural" | "visual" | "both";
}

export function AppComparisonWizard() {
  const [step, setStep] = useState(0);
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

  const canAdvance = () => {
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

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle">
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

        <Button
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1 || !canAdvance()}
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
        >
          Next
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
