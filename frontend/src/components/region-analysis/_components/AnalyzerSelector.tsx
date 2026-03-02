"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Settings2, ChevronDown, Grid3x3 } from "lucide-react";
import type { RegionAnalyzerInfo } from "@/services/regionAnalysis";
import type { AnalyzerSelectorProps } from "../types";

function groupByType(analyzers: RegionAnalyzerInfo[]) {
  return analyzers.reduce(
    (acc, analyzer) => {
      if (!acc[analyzer.type]) {
        acc[analyzer.type] = [];
      }
      acc[analyzer.type]!.push(analyzer);
      return acc;
    },
    {} as Record<string, RegionAnalyzerInfo[]>
  );
}

function AnalyzerConfigField({
  analyzerName,
  param,
  defaultValue,
  currentValue,
  onUpdate,
}: {
  analyzerName: string;
  param: string;
  defaultValue: unknown;
  currentValue: unknown;
  onUpdate: (analyzerName: string, param: string, value: unknown) => void;
}) {
  if (typeof defaultValue === "boolean") {
    return (
      <Switch
        checked={(currentValue as boolean | undefined) ?? defaultValue}
        onCheckedChange={(checked) => onUpdate(analyzerName, param, checked)}
      />
    );
  }

  if (typeof defaultValue === "number") {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={(currentValue as number | undefined) ?? defaultValue}
          onChange={(e) =>
            onUpdate(analyzerName, param, parseFloat(e.target.value))
          }
          className="w-24"
        />
        <span className="text-xs text-muted-foreground">
          Default: {defaultValue}
        </span>
      </div>
    );
  }

  return (
    <Input
      type="text"
      value={String(currentValue ?? defaultValue)}
      onChange={(e) => onUpdate(analyzerName, param, e.target.value)}
    />
  );
}

function AnalyzerCard({
  analyzer,
  isSelected,
  config,
  onToggle,
  onUpdateConfig,
}: {
  analyzer: RegionAnalyzerInfo;
  isSelected: boolean;
  config: Record<string, unknown> | undefined;
  onToggle: (name: string) => void;
  onUpdateConfig: (analyzerName: string, param: string, value: unknown) => void;
}) {
  const hasParams = Object.keys(analyzer.default_parameters).length > 0;

  return (
    <Collapsible>
      <div
        className={`border rounded-lg p-3 transition-colors ${
          isSelected ? "border-primary bg-accent" : "border-border"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Switch
                checked={isSelected}
                onCheckedChange={() => onToggle(analyzer.name)}
              />
              <div>
                <div className="font-medium flex items-center gap-2">
                  {analyzer.name}
                  {analyzer.detects_grids && (
                    <Badge variant="secondary" className="text-xs">
                      <Grid3x3 className="h-3 w-3 mr-1" />
                      Grid Detection
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  v{analyzer.version}
                  {analyzer.supports_multi_screenshot && " • Multi-screenshot"}
                  {analyzer.required_screenshots > 1 &&
                    ` • Requires ${analyzer.required_screenshots}+ screenshots`}
                </div>
              </div>
            </div>
          </div>

          {isSelected && hasParams && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <Settings2 className="h-4 w-4 mr-2" />
                Configure
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>

        <CollapsibleContent className="mt-3">
          <Separator className="mb-3" />
          <div className="space-y-3 pl-8">
            {Object.entries(analyzer.default_parameters).map(
              ([param, defaultValue]) => (
                <div key={param} className="space-y-2">
                  <Label className="text-sm">{param.replace(/_/g, " ")}</Label>
                  <AnalyzerConfigField
                    analyzerName={analyzer.name}
                    param={param}
                    defaultValue={defaultValue}
                    currentValue={config?.[param]}
                    onUpdate={onUpdateConfig}
                  />
                </div>
              )
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function AnalyzerSelector({
  analyzers,
  selectedAnalyzers,
  analyzerConfigs,
  onToggleAnalyzer,
  onSelectAll,
  onClearAll,
  onUpdateConfig,
}: AnalyzerSelectorProps) {
  const analyzersByType = groupByType(analyzers);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Select Analyzers</Label>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={onClearAll}>
            Clear All
          </Button>
        </div>
      </div>

      <ScrollArea className="h-96">
        <div className="space-y-4">
          {Object.entries(analyzersByType).map(([type, typeAnalyzers]) => (
            <div key={type} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-medium">
                  {type.replace("_", " ").toUpperCase()}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {typeAnalyzers.length} analyzer
                  {typeAnalyzers.length > 1 ? "s" : ""}
                </span>
              </div>

              {typeAnalyzers.map((analyzer) => (
                <AnalyzerCard
                  key={analyzer.name}
                  analyzer={analyzer}
                  isSelected={selectedAnalyzers.has(analyzer.name)}
                  config={analyzerConfigs[analyzer.name]}
                  onToggle={onToggleAnalyzer}
                  onUpdateConfig={onUpdateConfig}
                />
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
