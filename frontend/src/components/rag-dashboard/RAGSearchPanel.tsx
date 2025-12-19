"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, AlertCircle, Image as ImageIcon } from "lucide-react";
import { useRAGSearch } from "@/hooks/useRAGDashboard";
import type { SearchResultItem } from "@/types/rag-dashboard";

interface RAGSearchPanelProps {
  projectId: string;
}

export function RAGSearchPanel({ projectId }: RAGSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [minSimilarity, setMinSimilarity] = useState(0.5);
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
      <Card className="bg-gray-900/50 border-gray-800">
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
              className="flex-1 bg-gray-800 border-gray-700"
            />
            <Button
              onClick={handleSearch}
              disabled={!query.trim() || isPending}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
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
              <Label className="text-gray-400">
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
              <Label className="text-gray-400">Max Results: {limit}</Label>
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

          {/* Note about search being a placeholder */}
          <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-yellow-500 font-medium">Coming Soon</p>
              <p className="text-yellow-500/80">
                Semantic search requires text-to-embedding generation. The backend
                currently returns placeholder results.
              </p>
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
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between">
              <span>Results</span>
              <Badge variant="outline" className="border-gray-700 text-gray-400">
                {data.total_found} found
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.results.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">No results found</p>
                <p className="text-gray-500 text-sm mt-1">
                  Try adjusting your search query or lowering the similarity threshold
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.results.map((result: SearchResultItem, index: number) => (
                  <div
                    key={result.embedding.id}
                    className="flex items-center gap-4 p-3 bg-gray-800/50 rounded-lg"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 text-sm font-medium text-gray-300">
                      {index + 1}
                    </div>
                    <div className="w-12 h-12 bg-gray-700 rounded flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-white">
                        {result.embedding.pattern_name || result.embedding.pattern_id}
                      </p>
                      <p className="text-sm text-gray-400">
                        State: {result.embedding.state_name}
                      </p>
                    </div>
                    <Badge
                      className={`${
                        result.similarity_score > 0.8
                          ? "bg-[#00FF88]/20 text-[#00FF88] border-[#00FF88]/50"
                          : result.similarity_score > 0.6
                          ? "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/50"
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
