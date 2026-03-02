import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import type { UIBridgeRawResults } from "@/hooks/useUIBridgeExploration";

export function MetricsCard({ results }: { results: UIBridgeRawResults }) {
  const statesCount = results.state_discovery?.states.length || 0;
  const elementsCount = results.state_discovery?.unique_element_count || 0;

  return (
    <Card className="border-teal-500/30 bg-teal-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-teal-400">
          Exploration Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-2xl font-bold">{results.elements_discovered}</p>
            <p className="text-xs text-muted-foreground">Elements Found</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-green-500">
              {results.elements_explored}
            </p>
            <p className="text-xs text-muted-foreground">Explored</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-blue-500">
              {results.render_log_count}
            </p>
            <p className="text-xs text-muted-foreground">Render Logs</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-purple-500">{statesCount}</p>
            <p className="text-xs text-muted-foreground">States Discovered</p>
          </div>
        </div>

        {results.state_discovery && (
          <>
            <div className="my-4 border-t border-border" />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Unique Elements</span>
                <span className="font-medium">{elementsCount}</span>
              </div>
              <Progress
                value={
                  results.elements_discovered > 0
                    ? (results.elements_explored /
                        results.elements_discovered) *
                      100
                    : 0
                }
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-green-500">
                  {results.elements_explored} explored
                </span>
                <span className="text-yellow-500">
                  {results.elements_discovered - results.elements_explored}{" "}
                  remaining
                </span>
              </div>
            </div>
          </>
        )}

        {results.errors.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">
              {results.errors.length} errors encountered
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
