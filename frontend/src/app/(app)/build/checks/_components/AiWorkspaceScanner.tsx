"use client";

import { useState } from "react";
import { FolderSearch } from "lucide-react";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHECK_TYPE_BADGE_COLORS } from "../constants";
import type { SuggestedCheck } from "../check-utils";

interface AiWorkspaceScannerProps {
  onAcceptChecks: (checks: SuggestedCheck[]) => void;
}

export function AiWorkspaceScanner({ onAcceptChecks }: AiWorkspaceScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [, setScanResult] = useState<Record<string, unknown> | null>(null);
  const [suggestedChecks, setSuggestedChecks] = useState<SuggestedCheck[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState("");

  const handleScan = async () => {
    if (!workspaceDir.trim()) {
      setError("Please enter a workspace directory path.");
      return;
    }
    setScanning(true);
    setError(null);
    setScanResult(null);
    setSuggestedChecks([]);
    setSelectedSuggestions(new Set());

    try {
      const result = await runnerApi.scanWorkspace(workspaceDir.trim());
      setScanResult(result);

      // Now generate checks from scan
      setGenerating(true);
      const genResult = await runnerApi.generateChecks(result);
      if (genResult.success && genResult.suggested_checks) {
        const checks: SuggestedCheck[] = genResult.suggested_checks.map((sc) => ({
          name: sc.name || sc.check?.name || "Unnamed Check",
          check_type: sc.check?.check_type || "custom",
          tool: sc.check?.tool || "custom",
          command: sc.command || sc.check?.command || "",
          description: sc.reason || "",
          reason: sc.reason,
        }));
        setSuggestedChecks(checks);
        setSelectedSuggestions(new Set(checks.map((_, i) => i)));
      } else {
        setError(genResult.error || "Failed to generate check suggestions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace scan failed. Make sure the runner is connected.");
    } finally {
      setScanning(false);
      setGenerating(false);
    }
  };

  const toggleSuggestion = (index: number) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAccept = () => {
    const selected = suggestedChecks.filter((_, i) => selectedSuggestions.has(i));
    if (selected.length > 0) {
      onAcceptChecks(selected);
      setSuggestedChecks([]);
      setScanResult(null);
      setSelectedSuggestions(new Set());
    }
  };

  return (
    <AiGeneratorPanel
      title="AI Workspace Scanner"
      icon={FolderSearch}
      accentColor="violet"
      placeholder="Enter workspace directory path to scan..."
      generating={scanning || generating}
      error={error}
      onGenerate={(prompt) => {
        setWorkspaceDir(prompt);
        handleScan();
      }}
      extraInputs={
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Workspace Directory</Label>
          <Input
            value={workspaceDir}
            onChange={(e) => setWorkspaceDir(e.target.value)}
            placeholder="C:/path/to/your/project"
            className="bg-muted border-border h-8 text-sm"
          />
        </div>
      }
      templates={[
        { label: "Current Dir", prompt: "." },
        { label: "Parent Dir", prompt: ".." },
      ]}
      result={
        suggestedChecks.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {suggestedChecks.length} checks suggested
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedSuggestions.size} selected
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {suggestedChecks.map((check, i) => {
                const colors = CHECK_TYPE_BADGE_COLORS[check.check_type];
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                      ${selectedSuggestions.has(i)
                        ? "border-violet-500/40 bg-violet-500/5"
                        : "border-border bg-muted/50"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(i)}
                      onChange={() => toggleSuggestion(i)}
                      className="mt-0.5 w-3.5 h-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">{check.name}</span>
                        <Badge
                          variant="secondary"
                          className={`text-[9px] px-1 ${colors?.bg ?? ""} ${colors?.text ?? ""} ${colors?.border ?? ""}`}
                        >
                          {check.check_type}
                        </Badge>
                      </div>
                      {check.command && (
                        <code className="text-[10px] text-muted-foreground font-mono block truncate">
                          {check.command}
                        </code>
                      )}
                      {check.reason && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{check.reason}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ) : undefined
      }
      onAccept={suggestedChecks.length > 0 ? handleAccept : undefined}
      acceptLabel={`Create ${selectedSuggestions.size} Check${selectedSuggestions.size !== 1 ? "s" : ""}`}
    />
  );
}
