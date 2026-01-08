"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Image as ImageIcon } from "lucide-react";
import { useRAGSearch } from "@/hooks/useRAGDashboard";
import type { SearchResultItem } from "@/types/rag-dashboard";

interface RAGSearchPanelProps {
  projectId: string;
}

export function RAGSearchPanel({ projectId }: RAGSearchPanelProps) {
  const [query, setQuery] = useState("");
  // CLIP text-to-image similarity is typically 0.15-0.35, so default to 0.2
  const [minSimilarity, setMinSimilarity] = useState(0.2);
  const [limit, setLimit] = useState(20);

  const { mutate: search, data, isPending, error } = useRAGSearch(projectId);

  const handleSearch = () => {
    if (!query.trim()) return;
    search({
      query: query.trim(),
      limit,
      min_similarity: minSimilarity,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <Card className="bg-surface-canvas/50 border-border-subtle">
        <CardHeader>
          <CardTitle className="text-white">Semantic Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="Describe what you're looking for..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-surface-raised border-border-default"
            />
            <Button
              onClick={handleSearch}
              disabled={!query.trim() || isPending}
              className="bg-brand-primary hover:bg-brand-primary/80 text-black"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="ml-2">Search</span>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-text-muted">
                Min Similarity: {Math.round(minSimilarity * 100)}%
              </Label>
              <Slider
                value={[minSimilarity]}
                onValueChange={(values) => setMinSimilarity(values[0] ?? 0.5)}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-text-muted">Max Results: {limit}</Label>
              <Slider
                value={[limit]}
                onValueChange={(values) => setLimit(values[0] ?? 20)}
                min={5}
                max={50}
                step={5}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {error && (
        <Card className="bg-red-900/20 border-red-800">
          <CardContent className="p-6">
            <p className="text-red-400">Search failed: {error.message}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card className="bg-surface-canvas/50 border-border-subtle">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>Results</span>
              <Badge
                variant="outline"
                className="border-border-default text-text-muted"
              >
                {data.total_found} found
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.results.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-muted text-lg">No results found</p>
                <p className="text-text-muted text-sm mt-1">
                  Try adjusting your search query or lowering the similarity
                  threshold
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.results.map((result: SearchResultItem, index: number) => (
                  <div
                    key={result.embedding.id}
                    className="flex items-center gap-4 p-3 bg-surface-raised/50 rounded-lg"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-raised text-sm font-medium text-text-default">
                      {index + 1}
                    </div>
                    <div className="w-12 h-12 bg-surface-raised rounded flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-text-muted" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-white">
                        {result.embedding.pattern_name ||
                          result.embedding.pattern_id}
                      </p>
                      <p className="text-sm text-text-muted">
                        State: {result.embedding.state_name}
                      </p>
                    </div>
                    <Badge
                      className={`${
                        result.similarity_score > 0.8
                          ? "bg-brand-success/20 text-brand-success border-brand-success/50"
                          : result.similarity_score > 0.6
                            ? "bg-brand-primary/20 text-brand-primary border-brand-primary/50"
                            : "bg-yellow-500/20 text-yellow-500 border-yellow-500/50"
                      }`}
                      variant="outline"
                    >
                      {Math.round(result.similarity_score * 100)}% match
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
