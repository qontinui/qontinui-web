/**
 * BulkActions Component
 *
 * Toolbar that appears when images are selected, providing bulk operations
 * like move to folder, add tags, add to collection, download, and delete.
 */

"use client";

import React from "react";
import { X, Folder, Move, Tag, Package, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ImageFolder, ImageCollection } from "./types";

export interface BulkActionsProps {
  selectedCount: number;
  folders: ImageFolder[];
  collections: ImageCollection[];
  onBulkMove: (targetFolderId: string | null) => void;
  onBulkAddToCollection: (collectionId: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActions({
  selectedCount,
  folders,
  collections,
  onBulkMove,
  onBulkAddToCollection,
  onBulkDelete,
  onClearSelection,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center justify-between p-3 bg-brand-success/10 border-b border-brand-success/20">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{selectedCount} selected</span>
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-border-default"
            >
              <Move className="w-4 h-4 mr-2" />
              Move to Folder
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onBulkMove(null)}>
              Root (No Folder)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => onBulkMove(folder.id)}
              >
                <Folder
                  className="w-4 h-4 mr-2"
                  style={{ color: folder.color }}
                />
                {folder.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="border-border-default">
          <Tag className="w-4 h-4 mr-2" />
          Add Tags
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-border-default"
            >
              <Package className="w-4 h-4 mr-2" />
              Add to Collection
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {collections.map((collection) => (
              <DropdownMenuItem
                key={collection.id}
                onClick={() => onBulkAddToCollection(collection.id)}
              >
                {collection.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="border-border-default">
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>

        <DestructiveButton
          size="sm"
          className="border-red-700 text-red-400 hover:bg-red-900/20"
          onClick={onBulkDelete}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete
        </DestructiveButton>

        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
