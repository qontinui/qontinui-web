/**
 * Project Screenshot Selector Component
 * Allows selecting existing screenshots from the project
 */

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Image, CheckCircle, Circle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
interface APIScreenshot {
  id: string;
  name: string;
  hash: string;
  size: number;
  created_at: string;
  thumbnail_url?: string;
}


interface ProjectScreenshot {
  id: string;
  name: string;
  hash: string;
  size: number;
  createdAt: string;
  thumbnailUrl?: string;
}

interface ProjectScreenshotSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (screenshots: ProjectScreenshot[]) => void;
  currentHashes?: string[]; // Hashes of currently loaded screenshots
}

const ProjectScreenshotSelector: React.FC<ProjectScreenshotSelectorProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentHashes = [],
}) => {
  const [projectScreenshots, setProjectScreenshots] = useState<
    ProjectScreenshot[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);

  // Load project screenshots
  useEffect(() => {
    if (isOpen) {
      loadProjectScreenshots();
    }
  }, [isOpen]);

  const loadProjectScreenshots = async () => {
    setLoading(true);
    try {
      // Use default project ID for now
      const projectId = "default";

      // Call actual API
      const response = await fetch(
        `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`
      );

      if (!response.ok) {
        throw new Error("Failed to load screenshots");
      }

      const data = await response.json();

      // Map API response to component format
      const screenshots: ProjectScreenshot[] = data.screenshots.map((s: APIScreenshot) => ({
          id: s.id,
          name: s.name,
          hash: s.hash,
          size: s.size,
          createdAt: s.created_at,
          thumbnailUrl: s.thumbnail_url,
        })
      );

      setProjectScreenshots(screenshots);
    } catch (error) {
      console.error("Failed to load project screenshots:", error);
      // Set empty array on error
      setProjectScreenshots([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleSelectAll = () => {
    const filtered = getFilteredScreenshots();
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.id)));
    }
  };

  const handleConfirm = () => {
    const selected = projectScreenshots.filter((s) => selectedIds.has(s.id));
    onSelect(selected);
    onClose();
  };

  const getFilteredScreenshots = () => {
    return projectScreenshots.filter((screenshot) =>
      screenshot.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const filteredScreenshots = getFilteredScreenshots();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Select Project Screenshots</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Controls */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search screenshots..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              {selectedIds.size === filteredScreenshots.length
                ? "Deselect All"
                : "Select All"}
            </Button>
          </div>

          {/* Screenshot List */}
          <ScrollArea className="h-[400px] border rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Loading project screenshots...</p>
              </div>
            ) : filteredScreenshots.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">No screenshots found</p>
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {filteredScreenshots.map((screenshot) => {
                  const isSelected = selectedIds.has(screenshot.id);
                  const isDuplicate = currentHashes.includes(screenshot.hash);

                  return (
                    <Card
                      key={screenshot.id}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "border-blue-500 bg-blue-50"
                          : "hover:bg-gray-50"
                      }`}
                      onClick={() =>
                        !isDuplicate && handleToggleSelect(screenshot.id)
                      }
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          {/* Checkbox */}
                          <div className="flex-shrink-0">
                            {isDuplicate ? (
                              <CheckCircle className="h-5 w-5 text-gray-400" />
                            ) : isSelected ? (
                              <CheckCircle className="h-5 w-5 text-blue-500" />
                            ) : (
                              <Circle className="h-5 w-5 text-gray-400" />
                            )}
                          </div>

                          {/* Thumbnail */}
                          <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                            {screenshot.thumbnailUrl ? (
                              <img
                                src={`http://localhost:8000${screenshot.thumbnailUrl}`}
                                alt={screenshot.name}
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <Image className="h-8 w-8 text-gray-400" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {screenshot.name}
                            </p>
                            <p className="text-sm text-gray-500">
                              {formatFileSize(screenshot.size)} •{" "}
                              {formatDate(screenshot.createdAt)}
                            </p>
                          </div>

                          {/* Status */}
                          {isDuplicate && (
                            <Badge variant="secondary">Already loaded</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Selection Summary */}
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              {selectedIds.size} screenshot{selectedIds.size !== 1 ? "s" : ""}{" "}
              selected
            </span>
            {currentHashes.length > 0 && (
              <span className="text-gray-500">
                {currentHashes.length} already loaded
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add Selected ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectScreenshotSelector;
