/**
 * UploadDialog Component
 *
 * Collections sidebar with create, delete, and thumbnail grid display.
 * (Named UploadDialog to match the task specification; this component
 * manages the collections view in the sidebar.)
 */

"use client";

import React, { useState } from "react";
import { Plus, Trash2, Check, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ImageCollection, ImageWithMetadata } from "./types";
import { LazyImage } from "./LazyImage";
import { getImageUrl } from "./utils";

// ============================================================================
// CollectionsSidebar
// ============================================================================

export interface CollectionsSidebarProps {
  collections: ImageCollection[];
  onCreateCollection: (name: string, description?: string) => void;
  onUpdateCollection: (id: string, updates: Partial<ImageCollection>) => void;
  onDeleteCollection: (id: string) => void;
  images: ImageWithMetadata[];
}

export function CollectionsSidebar({
  collections,
  onCreateCollection,
  onUpdateCollection: _onUpdateCollection,
  onDeleteCollection,
  images,
}: CollectionsSidebarProps) {
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  const handleCreate = () => {
    if (newCollectionName.trim()) {
      onCreateCollection(newCollectionName);
      setNewCollectionName("");
      setShowNewCollection(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-subtle">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewCollection(!showNewCollection)}
          className="w-full border-border-default"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Collection
        </Button>

        {showNewCollection && (
          <div className="mt-2 flex gap-1">
            <Input
              placeholder="Collection name..."
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="text-sm bg-transparent border-border-default"
            />
            <Button
              size="sm"
              onClick={handleCreate}
              className="bg-brand-success text-black"
            >
              <Check className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {collections.map((collection) => (
            <Card
              key={collection.id}
              className="border-border-default bg-surface-raised hover:border-border-subtle transition-colors cursor-pointer"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-sm">{collection.name}</h4>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <DestructiveButton
                          onClick={() => onDeleteCollection(collection.id)}
                          className="w-full justify-start text-red-400"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DestructiveButton>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Thumbnail Grid */}
                <div className="grid grid-cols-2 gap-1 mb-2">
                  {collection.thumbnailIds.slice(0, 4).map((imageId) => {
                    const image = images.find((img) => img.id === imageId);
                    return (
                      <div
                        key={imageId}
                        className="aspect-square bg-surface-canvas rounded overflow-hidden"
                      >
                        {image && (
                          <LazyImage
                            src={getImageUrl(image, "thumb")}
                            alt={image.name}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="text-xs text-text-muted">
                  {collection.imageIds.length} image
                  {collection.imageIds.length !== 1 && "s"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
