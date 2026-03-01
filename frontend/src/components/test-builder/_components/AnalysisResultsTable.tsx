"use client";

import { Camera, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CollectedAnalysis } from "../page-analyzer-types";
import {
  flattenElements,
  getTypeBadgeVariant,
  getTypeLabel,
  getItemCount,
} from "../page-analyzer-utils";

interface AnalysisResultsTableProps {
  analyses: CollectedAnalysis[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  removeAnalysis: (id: string) => void;
}

export function AnalysisResultsTable({
  analyses,
  expandedId,
  setExpandedId,
  removeAnalysis,
}: AnalysisResultsTableProps) {
  return (
    <div className="border-t border-border-subtle/50 pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="size-4 text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">
            Collected Analyses
          </span>
          {analyses.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {analyses.length}
            </Badge>
          )}
        </div>
      </div>

      {analyses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-border-subtle/50 rounded-lg bg-surface-raised/10">
          <Camera className="size-8 text-muted-foreground opacity-30 mb-2" />
          <p className="text-xs text-muted-foreground">
            No analyses collected yet.
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Use the tabs above to run analyses. Results appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {analyses.map((analysis) => (
            <Collapsible
              key={analysis.id}
              open={expandedId === analysis.id}
              onOpenChange={(open) => setExpandedId(open ? analysis.id : null)}
            >
              {/* Analysis Row */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle/50 bg-surface-raised/20 hover:bg-surface-raised/40 transition-colors">
                <Badge variant={getTypeBadgeVariant(analysis.type)}>
                  {getTypeLabel(analysis.type)}
                </Badge>
                <span className="flex-1 text-xs text-text-primary truncate">
                  {analysis.name}
                </span>
                <span className="text-[10px] text-text-muted whitespace-nowrap">
                  {getItemCount(analysis)}
                </span>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6">
                    <Eye className="size-3" />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-red-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnalysis(analysis.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>

              {/* Expanded Detail */}
              <CollapsibleContent>
                <div className="mt-1 px-3 py-3 rounded-lg border border-border-subtle/30 bg-surface-canvas/50">
                  {/* UI Bridge details */}
                  {analysis.type === "ui_bridge" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span>URL: {analysis.data.url}</span>
                        <span>Title: {analysis.data.title}</span>
                        <span>
                          {analysis.data.elements.length} top-level elements
                        </span>
                      </div>
                      <ScrollArea className="max-h-48">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border-subtle/30">
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                #
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Tag
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Role
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Text
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {flattenElements(analysis.data.elements)
                              .slice(0, 25)
                              .map((el, idx) => (
                                <tr
                                  key={`${el.id}-${idx}`}
                                  className="border-b border-border-subtle/20"
                                >
                                  <td className="px-2 py-1 text-text-muted">
                                    {idx + 1}
                                  </td>
                                  <td className="px-2 py-1 text-text-secondary font-mono">
                                    {"  ".repeat(el.depth)}
                                    {"<"}
                                    {el.tag}
                                    {">"}
                                  </td>
                                  <td className="px-2 py-1 text-text-muted">
                                    {el.role || "-"}
                                  </td>
                                  <td className="px-2 py-1 text-text-muted truncate max-w-[200px]">
                                    {el.text || el.label || "-"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {flattenElements(analysis.data.elements).length >
                          25 && (
                          <p className="text-[10px] text-text-muted mt-1 px-2">
                            ...and{" "}
                            {flattenElements(analysis.data.elements).length -
                              25}{" "}
                            more elements
                          </p>
                        )}
                      </ScrollArea>
                    </div>
                  )}

                  {/* Vision details */}
                  {analysis.type === "vision" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span>Monitor: {analysis.data.monitor_index ?? 0}</span>
                        <span>
                          {analysis.data.elements.length} detected elements
                        </span>
                        <span>
                          Captured:{" "}
                          {new Date(
                            analysis.data.captured_at
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                      {analysis.data.annotated_screenshot_base64 && (
                        <div className="border border-border-subtle/30 rounded overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:image/png;base64,${analysis.data.annotated_screenshot_base64}`}
                            alt="Annotated screenshot"
                            className="w-full max-h-48 object-contain bg-black"
                          />
                        </div>
                      )}
                      <ScrollArea className="max-h-40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border-subtle/30">
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                #
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Label
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Type
                              </th>
                              <th className="px-2 py-1 text-left text-text-muted font-medium">
                                Confidence
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.data.elements
                              .slice(0, 20)
                              .map((el, idx) => (
                                <tr
                                  key={el.id}
                                  className="border-b border-border-subtle/20"
                                >
                                  <td className="px-2 py-1 text-text-muted">
                                    {idx + 1}
                                  </td>
                                  <td className="px-2 py-1 text-text-secondary">
                                    {el.label}
                                  </td>
                                  <td className="px-2 py-1 text-text-muted">
                                    {el.element_type}
                                  </td>
                                  <td className="px-2 py-1 text-text-muted">
                                    {(el.confidence * 100).toFixed(0)}%
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {analysis.data.elements.length > 20 && (
                          <p className="text-[10px] text-text-muted mt-1 px-2">
                            ...and {analysis.data.elements.length - 20} more
                          </p>
                        )}
                      </ScrollArea>
                    </div>
                  )}

                  {/* API Request details */}
                  {analysis.type === "api_request" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span className="font-mono font-semibold text-text-secondary">
                          {analysis.data.method}
                        </span>
                        <span className="truncate">{analysis.data.url}</span>
                        {analysis.data.status_code != null && (
                          <span
                            className={
                              analysis.data.status_code < 400
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {analysis.data.status_code}
                          </span>
                        )}
                        {analysis.data.duration_ms != null && (
                          <span>{analysis.data.duration_ms}ms</span>
                        )}
                      </div>
                      <ScrollArea className="max-h-48">
                        <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap p-2 bg-surface-raised/30 rounded">
                          {JSON.stringify(analysis.data.response, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  )}

                  {/* Step Output details */}
                  {analysis.type === "step_output" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span className="font-mono">
                          {analysis.data.step_type}
                        </span>
                        <span
                          className={
                            analysis.data.success
                              ? "text-green-400"
                              : "text-red-400"
                          }
                        >
                          {analysis.data.success ? "Success" : "Failed"}
                        </span>
                        {analysis.data.duration_ms > 0 && (
                          <span>{analysis.data.duration_ms}ms</span>
                        )}
                      </div>
                      {analysis.data.error && (
                        <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                          {analysis.data.error}
                        </div>
                      )}
                      {analysis.data.stdout && (
                        <ScrollArea className="max-h-48">
                          <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap p-2 bg-surface-raised/30 rounded">
                            {analysis.data.stdout.slice(0, 5000)}
                            {analysis.data.stdout.length > 5000 &&
                              "\n...truncated"}
                          </pre>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
