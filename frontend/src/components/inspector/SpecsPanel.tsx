"use client";

import type { DiscoveredSpec } from "@/hooks/use-inspector";
import type { SpecConfig, SpecGroup } from "@qontinui/ui-bridge/specs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Search,
  Loader2,
  AlertCircle,
  FileJson,
  Download,
  ChevronDown,
} from "lucide-react";

interface SpecsPanelProps {
  discoveredSpecs: DiscoveredSpec[];
  isLoading: boolean;
  onDiscover: () => void;
  onExport: (spec: DiscoveredSpec) => void;
  expandedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  isConnected: boolean;
}

export function SpecsPanel({
  discoveredSpecs,
  isLoading,
  onDiscover,
  onExport,
  expandedGroups,
  onToggleGroup,
  isConnected,
}: SpecsPanelProps) {
  const totalGroups = discoveredSpecs.reduce(
    (sum, s) => sum + ((s.config as SpecConfig)?.groups?.length || 0),
    0
  );
  const totalAssertions = discoveredSpecs.reduce(
    (sum, s) =>
      sum +
      ((s.config as SpecConfig)?.groups || []).reduce(
        (gs: number, g: SpecGroup) => gs + g.assertions.length,
        0
      ),
    0
  );

  return (
    <div className="space-y-6">
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Page Specs
          </CardTitle>
          <CardDescription className="text-text-muted">
            Discover page specs from the connected app&apos;s SpecStore
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={onDiscover}
              disabled={isLoading || !isConnected}
              className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Discovering...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Discover Specs
                </>
              )}
            </Button>
            {discoveredSpecs.length > 0 && (
              <div className="flex items-center gap-3 text-sm text-text-muted">
                <span>{discoveredSpecs.length} spec(s)</span>
                <span>{totalGroups} group(s)</span>
                <span>{totalAssertions} assertion(s)</span>
              </div>
            )}
          </div>

          {!isConnected && (
            <div className="flex items-center gap-2 text-amber-400 bg-amber-950/20 border border-amber-500/30 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">Connect to an app to discover specs</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discovered Specs */}
      {discoveredSpecs.map((spec) => {
        const config = spec.config as SpecConfig;
        return (
          <Card
            key={spec.specId}
            className="bg-surface-raised/50 border-border-subtle/50"
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-purple-400" />
                  {spec.specId}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onExport(spec)}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Export JSON
                </Button>
              </div>
              {config?.description && (
                <CardDescription className="text-text-muted">
                  {config.description}
                </CardDescription>
              )}
              {config?.version && (
                <Badge variant="secondary" className="w-fit text-[10px]">
                  v{config.version}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {config?.groups?.map((group) => (
                <div
                  key={group.id}
                  className="rounded-lg border border-border-subtle/30 overflow-hidden"
                >
                  <button
                    onClick={() => onToggleGroup(group.id)}
                    className="w-full flex items-center gap-2 p-3 text-left hover:bg-surface-hover transition-colors"
                  >
                    <ChevronDown
                      className={`w-4 h-4 text-text-muted transition-transform ${
                        expandedGroups.has(group.id) ? "" : "-rotate-90"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-text-primary">
                        {group.name}
                      </span>
                      {group.description && (
                        <p className="text-xs text-text-muted truncate">
                          {group.description}
                        </p>
                      )}
                    </div>
                    {group.category && (
                      <Badge
                        variant="outline"
                        className="text-[10px] flex-shrink-0"
                      >
                        {group.category}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="text-[10px] flex-shrink-0"
                    >
                      {group.assertions.filter((a) => a.enabled).length}/
                      {group.assertions.length}
                    </Badge>
                  </button>

                  {expandedGroups.has(group.id) && (
                    <div className="border-t border-border-subtle/30 divide-y divide-border-subtle/20">
                      {group.assertions.map((assertion) => (
                        <div
                          key={assertion.id}
                          className={`px-3 py-2 flex items-start gap-2 ${
                            !assertion.enabled ? "opacity-50" : ""
                          }`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                              assertion.severity === "critical"
                                ? "bg-red-400"
                                : assertion.severity === "warning"
                                  ? "bg-amber-400"
                                  : "bg-blue-400"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary">
                              {assertion.description}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge
                                variant={
                                  assertion.severity === "critical"
                                    ? "destructive"
                                    : assertion.severity === "warning"
                                      ? "warning"
                                      : "info"
                                }
                                className="text-[9px] px-1 py-0"
                              >
                                {assertion.severity}
                              </Badge>
                              {assertion.assertionType && (
                                <span className="text-[10px] text-text-muted font-mono">
                                  {assertion.assertionType}
                                </span>
                              )}
                              {assertion.target?.label && (
                                <span className="text-[10px] text-text-muted">
                                  &rarr; {assertion.target.label}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant={
                              assertion.enabled ? "success" : "secondary"
                            }
                            className="text-[9px] px-1 py-0 flex-shrink-0"
                          >
                            {assertion.enabled ? "ON" : "OFF"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {config?.metadata && (
                <details className="mt-2">
                  <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                    Metadata
                  </summary>
                  <pre className="text-xs text-text-muted mt-1 bg-surface-canvas/50 rounded p-2 overflow-x-auto">
                    {JSON.stringify(config.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}

      {discoveredSpecs.length === 0 && !isLoading && (
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="py-12">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto mb-4 text-text-muted" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">
                No Specs Discovered
              </h3>
              <p className="text-sm text-text-muted max-w-md mx-auto">
                Connect to an app that has page specs registered via
                usePageSpecs(), then click &quot;Discover Specs&quot; to view
                and inspect them.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
