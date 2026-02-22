"use client";

import type { ExternalElement } from "@/hooks/use-inspector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search,
  Box,
  Eye,
  MousePointerClick,
  ChevronRight,
} from "lucide-react";
import { ElementDetails } from "./ElementDetails";

interface ElementsPanelProps {
  elements: ExternalElement[];
  filteredElements: ExternalElement[];
  selectedElement: ExternalElement | null;
  onSelectElement: (el: ExternalElement) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function ElementsPanel({
  elements,
  filteredElements,
  selectedElement,
  onSelectElement,
  searchQuery,
  onSearchChange,
}: ElementsPanelProps) {
  if (elements.length === 0) return null;

  return (
    <>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <Input
          placeholder="Search elements by id, type, role, or text..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Element List */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Box className="w-4 h-4" />
              Elements ({filteredElements.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="space-y-1 overflow-y-auto"
              style={{ maxHeight: "500px" }}
            >
              {filteredElements.length === 0 ? (
                <p className="text-sm text-text-muted py-4 text-center">
                  No elements match your search
                </p>
              ) : (
                filteredElements.map((el) => (
                  <button
                    key={el.id}
                    onClick={() => onSelectElement(el)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selectedElement?.id === el.id
                        ? "border-purple-500/50 bg-purple-950/20"
                        : "border-border-subtle/30 bg-surface-canvas/30 hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {el.is_interactive || el.interactive ? (
                          <MousePointerClick className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                        )}
                        <span className="text-sm font-mono text-text-primary truncate">
                          {el.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {el.type && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {el.type}
                          </Badge>
                        )}
                        {(el.is_interactive || el.interactive) && (
                          <Badge
                            variant="info"
                            className="text-[10px] px-1.5 py-0"
                          >
                            interactive
                          </Badge>
                        )}
                        <ChevronRight className="w-3 h-3 text-text-muted" />
                      </div>
                    </div>
                    {el.text && (
                      <p className="text-xs text-text-muted mt-1 truncate pl-5">
                        {el.text}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Element Details */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Element Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedElement ? (
              <ElementDetails element={selectedElement} />
            ) : (
              <div className="text-center py-12">
                <Eye className="w-10 h-10 mx-auto mb-3 text-text-muted" />
                <p className="text-sm text-text-muted">
                  Click on an element to view its details
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
