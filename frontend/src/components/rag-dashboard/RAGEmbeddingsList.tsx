"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { useRAGEmbeddings, useRAGStates } from "@/hooks/useRAGDashboard";
import type { EmbeddingItem } from "@/types/rag-dashboard";

interface RAGEmbeddingsListProps {
  projectId: string;
}

export function RAGEmbeddingsList({ projectId }: RAGEmbeddingsListProps) {
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<string | undefined>(undefined);
  const limit = 20;

  const { data: statesData } = useRAGStates(projectId);
  const { data, isLoading, error } = useRAGEmbeddings(projectId, {
    page,
    limit,
    state_filter: stateFilter,
  });

  const handleStateChange = (value: string) => {
    setStateFilter(value === "all" ? undefined : value);
    setPage(1); // Reset to first page on filter change
  };

  if (error) {
    return (
      <Card className="bg-red-900/20 border-red-800">
        <CardContent className="p-6">
          <p className="text-red-400">
            Failed to load embeddings: {error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Indexed Elements</CardTitle>
          <Select
            value={stateFilter ?? "all"}
            onValueChange={handleStateChange}
          >
            <SelectTrigger className="w-48 bg-gray-800 border-gray-700">
              <SelectValue placeholder="Filter by state" />
            </SelectTrigger>
            <SelectContent className="bg-gray-800 border-gray-700">
              <SelectItem value="all">All States</SelectItem>
              {statesData?.states.map((state) => (
                <SelectItem key={state.state_id} value={state.state_id}>
                  {state.state_name} ({state.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-gray-800" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <div className="text-center py-12">
            <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No embeddings found</p>
            <p className="text-gray-500 text-sm mt-1">
              Connect a runner and process your project configuration to
              generate embeddings
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800">
                  <TableHead className="text-gray-400 w-[300px]">
                    Pattern
                  </TableHead>
                  <TableHead className="text-gray-400">State</TableHead>
                  <TableHead className="text-gray-400">Size</TableHead>
                  <TableHead className="text-gray-400">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((embedding: EmbeddingItem) => (
                  <TableRow key={embedding.id} className="border-gray-800">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gray-800 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                          {embedding.image_url ? (
                            <img
                              src={embedding.image_url}
                              alt={
                                embedding.pattern_name || embedding.pattern_id
                              }
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                // On error, show placeholder icon
                                const target = e.target as HTMLImageElement;
                                target.style.display = "none";
                                target.nextElementSibling?.classList.remove(
                                  "hidden"
                                );
                              }}
                            />
                          ) : null}
                          <ImageIcon
                            className={`w-5 h-5 text-gray-500 ${embedding.image_url ? "hidden" : ""}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white truncate">
                              {embedding.pattern_name || embedding.pattern_id}
                            </p>
                            {embedding.has_text_embedding && (
                              <span title="Text embedding available">
                                <FileText className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                              </span>
                            )}
                          </div>
                          {embedding.text_description ? (
                            <p
                              className="text-xs text-gray-400 truncate"
                              title={embedding.text_description}
                            >
                              {embedding.text_description}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-500">
                              {embedding.image_width}x{embedding.image_height}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-[#BD00FF]/50 text-[#BD00FF]"
                      >
                        {embedding.state_name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-400 text-sm">
                        {embedding.image_width}x{embedding.image_height}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-400 text-sm">
                        {new Date(embedding.updated_at).toLocaleDateString()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * limit + 1} -{" "}
                {Math.min(page * limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-gray-700"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-gray-400">
                  Page {page} of {Math.ceil(data.total / limit)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data.has_more}
                  className="border-gray-700"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
