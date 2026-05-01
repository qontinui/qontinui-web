"use client";

import { useExpandableSet } from "@/hooks/useExpandableSet";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  ZoomIn,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { TransitionResult } from "@/services/testing-service";
import { format } from "date-fns";
import Image from "next/image";

interface TimelineTabProps {
  transitions: TransitionResult[];
  onImageSelect: (url: string) => void;
}

export function TimelineTab({ transitions, onImageSelect }: TimelineTabProps) {
  const { expanded: expandedSteps, toggle: toggleStep } = useExpandableSet();

  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle>Execution Timeline</CardTitle>
        <CardDescription>
          Step-by-step breakdown of all transitions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-2">
            {transitions.map((transition, index) => {
              const isExpanded = expandedSteps.has(transition.id);
              return (
                <div
                  key={transition.id}
                  className={`rounded-lg border ${
                    transition.success
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-red-500/30 bg-red-500/5"
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/5"
                    onClick={() => toggleStep(transition.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-background/50 flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-shrink-0">
                      {transition.success ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {transition.from_state}
                        </span>
                        <span className="text-muted-foreground">&rarr;</span>
                        <span className="font-medium text-sm">
                          {transition.to_state}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {transition.action_type}
                        </Badge>
                        <span>{transition.duration_ms}ms</span>
                        <span>
                          {format(
                            new Date(transition.executed_at),
                            "HH:mm:ss.SSS"
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {transition.screenshot_url && (
                        <div className="flex-shrink-0">
                          <Image
                            src={transition.screenshot_url}
                            alt="Transition screenshot"
                            width={60}
                            height={45}
                            className="rounded border border-border cursor-pointer hover:border-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              onImageSelect(transition.screenshot_url!);
                            }}
                          />
                        </div>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border">
                      <div className="grid grid-cols-2 gap-4 pt-3">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            From State
                          </div>
                          <div className="text-sm font-mono">
                            {transition.from_state}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            To State
                          </div>
                          <div className="text-sm font-mono">
                            {transition.to_state}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            Action Type
                          </div>
                          <div className="text-sm">
                            {transition.action_type}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            Duration
                          </div>
                          <div className="text-sm">
                            {transition.duration_ms}ms
                          </div>
                        </div>
                      </div>

                      {transition.error_message && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                          <div className="text-xs text-red-400 mb-1 font-semibold">
                            Error
                          </div>
                          <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap">
                            {transition.error_message}
                          </pre>
                        </div>
                      )}

                      {transition.screenshot_url && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-2">
                            Screenshot
                          </div>
                          <div className="relative">
                            <Image
                              src={transition.screenshot_url}
                              alt="Transition screenshot"
                              width={400}
                              height={300}
                              className="rounded border border-border cursor-pointer hover:border-primary"
                              onClick={() =>
                                onImageSelect(transition.screenshot_url!)
                              }
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              className="absolute top-2 right-2"
                              onClick={() =>
                                onImageSelect(transition.screenshot_url!)
                              }
                            >
                              <ZoomIn className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {transitions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No transitions recorded yet
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
