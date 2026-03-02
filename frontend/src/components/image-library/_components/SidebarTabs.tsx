"use client";

import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FolderTreeSidebar } from "../FolderTree";
import { CollectionsSidebar } from "../UploadDialog";
import type {
  ImageFolderTreeNode,
  ImageFolder,
  ImageCollection,
  ImageWithMetadata,
} from "../types";

interface SidebarTabsProps {
  folderTree: ImageFolderTreeNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<ImageFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onToggleExpanded: (folderId: string) => void;
  collections: ImageCollection[];
  onCreateCollection: (
    name: string,
    description?: string,
    imageIds?: string[]
  ) => void;
  onUpdateCollection: (id: string, updates: Partial<ImageCollection>) => void;
  onDeleteCollection: (id: string) => void;
  images: ImageWithMetadata[];
}

export function SidebarTabs({
  folderTree,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleExpanded,
  collections,
  onCreateCollection,
  onUpdateCollection,
  onDeleteCollection,
  images,
}: SidebarTabsProps) {
  const [activeTab, setActiveTab] = useState<"library" | "collections">(
    "library"
  );

  return (
    <div className="w-64 border-r border-border-subtle flex flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "library" | "collections")}
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid w-full grid-cols-2 bg-surface-raised m-2">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="flex-1 overflow-hidden mt-0">
          <FolderTreeSidebar
            folders={folderTree}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onCreateFolder={onCreateFolder}
            onUpdateFolder={onUpdateFolder}
            onDeleteFolder={onDeleteFolder}
            onToggleExpanded={onToggleExpanded}
          />
        </TabsContent>

        <TabsContent
          value="collections"
          className="flex-1 overflow-hidden mt-0"
        >
          <CollectionsSidebar
            collections={collections}
            onCreateCollection={onCreateCollection}
            onUpdateCollection={onUpdateCollection}
            onDeleteCollection={onDeleteCollection}
            images={images}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
