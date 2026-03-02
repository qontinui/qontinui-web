"use client";

import React, { useState, useMemo } from "react";
import { useAutomation } from "@/contexts/automation-context";
import type { ImageWithMetadata } from "./types";
import { useImageOrganization } from "./useImageOrganization";
import { ImageUploadProgress } from "@/components/ImageUploadProgress";
import { MaskEditor } from "@/components/mask-editor";
import { ImageDeletionDialog } from "@/components/image-deletion-dialog";
import { MonitorSelector } from "@/components/monitor-selector";
import { FilterBar } from "./FilterBar";
import { BulkActions } from "./BulkActions";
import { useImageUpload } from "@/hooks/useImageUpload";
import {
  useFilteredImages,
  useImageOperations,
  useBulkActions,
  useImageUsageDetails,
} from "./_hooks";
import { Toolbar, SidebarTabs, ImageContentArea } from "./_components";

export function ImageLibrary() {
  const {
    images: contextImages,
    addImage,
    updateImage,
    deleteImage,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    projectId,
    projectName,
    workflows,
    states,
  } = useAutomation();

  const images = useMemo<ImageWithMetadata[]>(() => {
    return contextImages.map((img) => ({
      ...img,
      folderId: (img as ImageWithMetadata).folderId,
      tags: (img as ImageWithMetadata).tags || [],
      selected: false,
    }));
  }, [contextImages]);

  const {
    folders,
    folderTree,
    createFolder,
    updateFolder,
    deleteFolder,
    toggleFolderExpanded,
    collections,
    createCollection,
    updateCollection,
    deleteCollection,
    addImagesToCollection,
    currentFilter,
    setCurrentFilter,
    selectedImageIds,
    toggleImageSelection,
    clearSelection,
  } = useImageOrganization({
    images,
    onUpdateImage: updateImage as (image: ImageWithMetadata) => void,
  });

  // View state
  const [viewMode, setViewMode] = useState<"grid" | "list" | "slideshow">(
    "grid"
  );
  const [gridSize, setGridSize] = useState<"small" | "medium" | "large">(
    "medium"
  );
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [uploadMonitors, setUploadMonitors] = useState<number[]>([0]);

  const filteredImages = useFilteredImages(
    images,
    selectedFolderId,
    currentFilter
  );

  const {
    dragActive,
    uploadingFiles,
    fileInputRef,
    handleDrag,
    handleDrop,
    handleFileInput,
  } = useImageUpload({
    projectId,
    projectName,
    selectedFolderId,
    uploadMonitors,
    addImage,
  });

  const {
    selectedImageId,
    setSelectedImageId,
    showMaskEditor,
    editingImage,
    showDeletionDialog,
    setShowDeletionDialog,
    imageToDelete,
    deletionUsageInfo,
    handleDeleteImage,
    confirmDelete,
    handleEditMask,
    handleSaveMask,
    closeMaskEditor,
  } = useImageOperations({
    images,
    getImageUsage,
    removeImageFromStates,
    markImageAsRemovedInProcesses,
    deleteImage,
    updateImage,
  });

  const { handleBulkMove, handleBulkAddToCollection, handleBulkDelete } =
    useBulkActions({
      images,
      selectedImageIds,
      updateImage,
      deleteImage,
      addImagesToCollection,
      clearSelection,
    });

  const selectedImage = useMemo(() => {
    return selectedImageId
      ? (images.find((img) => img.id === selectedImageId) ?? null)
      : null;
  }, [selectedImageId, images]);

  const imageUsageDetails = useImageUsageDetails(
    selectedImage,
    workflows,
    states
  );

  return (
    <div className="h-full flex flex-col bg-surface-canvas">
      <ImageUploadProgress uploads={uploadingFiles} />

      <Toolbar
        filteredCount={filteredImages.length}
        selectedCount={selectedImageIds.size}
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters(!showFilters)}
        onUploadClick={() => fileInputRef.current?.click()}
      />

      <div className="p-4 bg-surface-raised/50 border-b border-border-default">
        <MonitorSelector
          monitors={uploadMonitors}
          onChange={setUploadMonitors}
          label="Default Monitors for New Uploads"
          showLabel={true}
        />
      </div>

      {showFilters && (
        <FilterBar filter={currentFilter} onFilterChange={setCurrentFilter} />
      )}

      <BulkActions
        selectedCount={selectedImageIds.size}
        folders={folders}
        collections={collections}
        onBulkMove={handleBulkMove}
        onBulkAddToCollection={handleBulkAddToCollection}
        onBulkDelete={handleBulkDelete}
        onClearSelection={clearSelection}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      <div className="flex-1 flex overflow-hidden">
        <SidebarTabs
          folderTree={folderTree}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={createFolder}
          onUpdateFolder={updateFolder}
          onDeleteFolder={deleteFolder}
          onToggleExpanded={toggleFolderExpanded}
          collections={collections}
          onCreateCollection={createCollection}
          onUpdateCollection={updateCollection}
          onDeleteCollection={deleteCollection}
          images={images}
        />

        <ImageContentArea
          viewMode={viewMode}
          gridSize={gridSize}
          filteredImages={filteredImages}
          selectedImageIds={selectedImageIds}
          selectedImageId={selectedImageId}
          selectedImage={selectedImage}
          imageUsageDetails={imageUsageDetails}
          onSelectImage={setSelectedImageId}
          onToggleSelection={toggleImageSelection}
          onDeleteImage={handleDeleteImage}
          onEditMask={handleEditMask}
          dragActive={dragActive}
          onDrag={handleDrag}
          onDrop={handleDrop}
        />
      </div>

      {showMaskEditor && editingImage && (
        <MaskEditor
          imageUrl={editingImage.url}
          imageName={editingImage.name}
          initialMask={editingImage.mask}
          onSave={handleSaveMask}
          onCancel={closeMaskEditor}
          open={showMaskEditor}
        />
      )}

      <ImageDeletionDialog
        open={showDeletionDialog}
        onOpenChange={setShowDeletionDialog}
        imageName={imageToDelete?.name || ""}
        usageInfo={deletionUsageInfo}
        onConfirmDelete={confirmDelete}
      />
    </div>
  );
}

/**
 * @deprecated Use `ImageLibrary` instead. This alias exists for backward compatibility.
 */
export const EnhancedImageLibrary = ImageLibrary;
