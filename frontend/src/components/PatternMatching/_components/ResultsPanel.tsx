import React from "react";
import { Search, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { PatternMatch, PatternMatchResponse } from "@/lib/runner-client";

interface ResultsPanelProps {
  results: PatternMatchResponse | null;
  isSearching: boolean;
  similarity: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const SearchStats: React.FC<{ results: PatternMatchResponse }> = ({
  results,
}) => (
  <div className="grid grid-cols-3 gap-4">
    <div className="bg-muted/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">Search Time</p>
      <p className="text-lg font-mono">{results.search_time_ms.toFixed(1)}ms</p>
    </div>
    <div className="bg-muted/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">Screenshot Size</p>
      <p className="text-lg font-mono">
        {results.screenshot_width} x {results.screenshot_height}
      </p>
    </div>
    <div className="bg-muted/50 rounded-lg p-3">
      <p className="text-xs text-muted-foreground">Template Size</p>
      <p className="text-lg font-mono">
        {results.template_width} x {results.template_height}
      </p>
    </div>
  </div>
);

const MatchItem: React.FC<{ match: PatternMatch; index: number }> = ({
  match,
  index,
}) => (
  <div className="bg-muted/50 rounded-lg p-3">
    <div className="flex items-center justify-between mb-2">
      <span className="font-medium">Match #{index + 1}</span>
      <Badge
        variant={
          match.similarity > 0.9
            ? "default"
            : match.similarity > 0.8
              ? "secondary"
              : "outline"
        }
      >
        {(match.similarity * 100).toFixed(1)}%
      </Badge>
    </div>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>
        <span className="text-muted-foreground">Position: </span>
        <span className="font-mono">
          ({match.x}, {match.y})
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Size: </span>
        <span className="font-mono">
          {match.width} x {match.height}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Center: </span>
        <span className="font-mono">
          ({match.center_x}, {match.center_y})
        </span>
      </div>
    </div>
  </div>
);

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  results,
  isSearching,
  similarity,
  canvasRef,
}) => {
  return (
    <Card className="flex flex-col min-h-0">
      <CardHeader className="pb-3 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          Results
          {results && (
            <Badge variant={results.success ? "default" : "destructive"}>
              {results.success ? (
                <>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {results.matches.length} match
                  {results.matches.length !== 1 ? "es" : ""}
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 mr-1" />
                  Failed
                </>
              )}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        {!results && !isSearching && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Search className="w-12 h-12 mb-4 opacity-20" />
            <p>Run a search to see results</p>
          </div>
        )}

        {isSearching && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Searching...</p>
          </div>
        )}

        {results && !isSearching && (
          <Tabs defaultValue="visual" className="h-full flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="visual">Visual</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="visual" className="flex-1 overflow-auto mt-4">
              {results.matches.length > 0 ? (
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    className="max-w-full h-auto border rounded"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <XCircle className="w-12 h-12 mb-4 opacity-20" />
                  <p>
                    No matches found above {(similarity * 100).toFixed(0)}%
                    threshold
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="details" className="flex-1 overflow-auto mt-4">
              <div className="space-y-4">
                <SearchStats results={results} />

                {results.matches.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Matches</h4>
                    <div className="space-y-2">
                      {results.matches.map((match, index) => (
                        <MatchItem key={index} match={match} index={index} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No matches found
                  </div>
                )}

                {results.error && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                    <p className="text-sm text-destructive">{results.error}</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};
