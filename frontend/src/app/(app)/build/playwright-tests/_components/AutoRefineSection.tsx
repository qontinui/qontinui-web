"use client";

import {
  RefreshCw,
  X,
  Loader2,
} from "lucide-react";
import { EditorSection } from "@/components/builders/editors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface AutoRefineSectionProps {
  isAutoRefining: boolean;
  autoRefineIteration: number;
  autoRefineMaxIterations: number;
  setAutoRefineMaxIterations: (value: number) => void;
  autoRefineLog: string[];
  autoRefineUserHint: string;
  setAutoRefineUserHint: (value: string) => void;
  runAutoRefine: () => void;
  stopAutoRefine: () => void;
}

export function AutoRefineSection({
  isAutoRefining,
  autoRefineIteration,
  autoRefineMaxIterations,
  setAutoRefineMaxIterations,
  autoRefineLog,
  autoRefineUserHint,
  setAutoRefineUserHint,
  runAutoRefine,
  stopAutoRefine,
}: AutoRefineSectionProps) {
  return (
    <EditorSection title="AI Auto-Refine" icon={RefreshCw} defaultOpen={false}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Iteratively run the test, capture failures, and use AI to refine the script until tests pass.
        </p>

        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Max Iterations</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={autoRefineMaxIterations}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 5;
                setAutoRefineMaxIterations(v);
                try { localStorage.setItem("qontinui-autorefine-max-iterations", String(v)); } catch {}
              }}
              className="bg-muted border-border h-7 text-sm w-20"
              disabled={isAutoRefining}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">User Hint (optional)</Label>
          <Textarea
            value={autoRefineUserHint}
            onChange={(e) => setAutoRefineUserHint(e.target.value)}
            placeholder="Provide guidance for the AI during refinement..."
            className="min-h-[50px] text-sm bg-muted border-border resize-none"
            disabled={isAutoRefining}
          />
        </div>

        <div className="flex items-center gap-2">
          {isAutoRefining ? (
            <Button
              variant="outline"
              size="sm"
              onClick={stopAutoRefine}
              className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            >
              <X className="size-3.5 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={runAutoRefine}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={isAutoRefining}
            >
              <RefreshCw className="size-3.5 mr-1" />
              Start Auto-Refine
            </Button>
          )}
          {isAutoRefining && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Iteration {autoRefineIteration} / {autoRefineMaxIterations}
            </span>
          )}
        </div>

        {autoRefineLog.length > 0 && (
          <div className="bg-background border border-border rounded-lg p-2.5 max-h-48 overflow-y-auto font-mono text-[11px] text-muted-foreground space-y-0.5">
            {autoRefineLog.map((line, i) => (
              <div key={i} className={line.startsWith("---") ? "text-muted-foreground font-semibold mt-1" : ""}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </EditorSection>
  );
}
