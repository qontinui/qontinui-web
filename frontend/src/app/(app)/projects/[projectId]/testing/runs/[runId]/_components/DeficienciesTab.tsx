"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { Deficiency } from "@/services/testing-service";
import Image from "next/image";

interface DeficienciesTabProps {
  deficiencies: Deficiency[];
  onImageSelect: (url: string) => void;
}

export function DeficienciesTab({
  deficiencies,
  onImageSelect,
}: DeficienciesTabProps) {
  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle>Deficiencies Found</CardTitle>
        <CardDescription>
          Issues discovered during this test run
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          {deficiencies.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
              No deficiencies found in this test run
            </div>
          ) : (
            <div className="space-y-4">
              {deficiencies.map((deficiency) => (
                <div
                  key={deficiency.id}
                  className="p-4 rounded-lg bg-background/50 border border-red-500/30"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                      <span className="font-medium">{deficiency.title}</span>
                    </div>
                    <Badge
                      variant={
                        deficiency.severity === "critical" ||
                        deficiency.severity === "high"
                          ? "destructive"
                          : "outline"
                      }
                      className={
                        deficiency.severity === "medium"
                          ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                          : deficiency.severity === "low"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : ""
                      }
                    >
                      {deficiency.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {deficiency.description}
                  </p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>State: {deficiency.state_name}</div>
                    {deficiency.transition_from && deficiency.transition_to && (
                      <div>
                        Transition: {deficiency.transition_from} &rarr;{" "}
                        {deficiency.transition_to}
                      </div>
                    )}
                  </div>
                  {deficiency.error_message && (
                    <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded p-3">
                      <div className="text-xs text-red-400 mb-1 font-semibold">
                        Stack Trace
                      </div>
                      <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {deficiency.error_message}
                      </pre>
                    </div>
                  )}
                  {deficiency.screenshot_url && (
                    <div className="mt-3">
                      <div className="text-xs text-muted-foreground mb-2">
                        Screenshot
                      </div>
                      <Image
                        src={deficiency.screenshot_url}
                        alt="Deficiency screenshot"
                        width={200}
                        height={150}
                        className="rounded border border-border cursor-pointer hover:border-primary"
                        onClick={() =>
                          onImageSelect(deficiency.screenshot_url!)
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
