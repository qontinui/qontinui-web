"use client";

import React from "react";
import { useAutomation } from "@/contexts/automation-context";
import { MaskEditor } from "@/components/mask-editor";
import { ImageUploadProgress } from "@/components/ImageUploadProgress";
import { ImageDeletionDialog } from "@/components/image-deletion-dialog";
import { useImageUpload } from "./_hooks/use-image-upload";
import { useImageActions } from "./_hooks/use-image-actions";
import { useImageFilter } from "./_hooks/use-image-filter";
import { ImageHeader } from "./_components/ImageHeader";
import { SourceFilterBadges } from "./_components/SourceFilterBadges";
import { DropZone } from "./_components/DropZone";
import { ImageGallery } from "./_components/ImageGallery";

export function ImagesManager() {
  const { images } = useAutomation();

  const {
    uploadingFiles,
    fileInputRef,
    dragActive,
    handleDrag,
    handleDrop,
    handleFileInput,
  } = useImageUpload();

  const {
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
  } = useImageActions();

  const {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    imageCounts,
    filteredImages,
  } = useImageFilter(images);

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <ImageUploadProgress uploads={uploadingFiles} />

      <ImageHeader
        images={images}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onUploadClick={() => fileInputRef.current?.click()}
      />

      {images.length > 0 && (
        <SourceFilterBadges
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          imageCounts={imageCounts}
        />
      )}

      <DropZone
        dragActive={dragActive}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onChooseFiles={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      <ImageGallery
        filteredImages={filteredImages}
        searchQuery={searchQuery}
        onEditMask={handleEditMask}
        onDeleteImage={handleDeleteImage}
      />

      {showMaskEditor && editingImage && (
        <MaskEditor
          imageUrl={editingImage.url}
          imageName={editingImage.name}
          initialMask={editingImage.mask || undefined}
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
