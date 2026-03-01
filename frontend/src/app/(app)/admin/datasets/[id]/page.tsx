"use client";

/**
 * Dataset Viewer Page
 *
 * Detailed view of a training dataset with:
 * - Statistics overview
 * - Image browser with thumbnails
 * - Annotation viewing and editing
 * - Filter controls
 * - Review workflow
 */

import { Button } from "@/components/ui/button";
import { DatasetExportDialog } from "@/components/datasets/DatasetExportDialog";
import { Download, Filter, BarChart3 } from "lucide-react";
import { useDatasetViewer } from "./_hooks/use-dataset-viewer";
import { StatisticsBar } from "./_components/StatisticsBar";
import { FilterSidebar } from "./_components/FilterSidebar";
import { ImageGrid } from "./_components/ImageGrid";
import { AnnotationDetail } from "./_components/AnnotationDetail";

export default function DatasetViewerPage() {
  const {
    // State
    dataset,
    statistics,
    images,
    totalImages,
    selectedImage,
    annotations,
    selectedAnnotation,
    loading,
    authLoading,
    isAdmin,
    filters,
    showFilters,
    showStatistics,
    showExportDialog,
    selectedAnnotationIds,
    bulkProcessing,
    totalPages,
    datasetId,

    // Actions
    setSelectedImage,
    setSelectedAnnotation,
    setFilters,
    setShowFilters,
    setShowStatistics,
    setShowExportDialog,
    handleSourceFilterChange,
    handleReviewStatusFilterChange,
    handleApprove,
    handleReject,
    handleFlag,
    handleToggleAnnotationSelection,
    handleSelectAllAnnotations,
    handleBulkApprove,
    handleBulkReject,
    handleBulkFlag,
    navigateToDatasets,
  } = useDatasetViewer();

  if (authLoading || loading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (!isAdmin || !dataset) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="font-medium mb-2">Dataset Not Found</p>
          <Button variant="outline" size="sm" onClick={navigateToDatasets}>
            Back to Datasets
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={navigateToDatasets}>
            Datasets
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">{dataset.name}</h1>
          {dataset.description && (
            <span className="text-sm text-muted-foreground hidden lg:inline">
              {dataset.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowStatistics(!showStatistics)}
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Stats
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5 mr-1" />
            Filters
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowExportDialog(true)}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      <DatasetExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        datasetId={datasetId}
        datasetName={dataset.name}
      />

      {showStatistics && statistics && (
        <StatisticsBar statistics={statistics} />
      )}

      <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-border overflow-hidden">
        {showFilters && (
          <FilterSidebar
            filters={filters}
            onSourceFilterChange={handleSourceFilterChange}
            onReviewStatusFilterChange={handleReviewStatusFilterChange}
            onFiltersChange={setFilters}
          />
        )}

        <ImageGrid
          images={images}
          totalImages={totalImages}
          selectedImage={selectedImage}
          filters={filters}
          totalPages={totalPages}
          datasetId={datasetId}
          onSelectImage={setSelectedImage}
          onFiltersChange={setFilters}
          showFilters={showFilters}
        />

        <AnnotationDetail
          selectedImage={selectedImage}
          annotations={annotations}
          selectedAnnotation={selectedAnnotation}
          selectedAnnotationIds={selectedAnnotationIds}
          bulkProcessing={bulkProcessing}
          datasetId={datasetId}
          showFilters={showFilters}
          onSelectAnnotation={setSelectedAnnotation}
          onApprove={handleApprove}
          onReject={handleReject}
          onFlag={handleFlag}
          onToggleAnnotationSelection={handleToggleAnnotationSelection}
          onSelectAllAnnotations={handleSelectAllAnnotations}
          onBulkApprove={handleBulkApprove}
          onBulkReject={handleBulkReject}
          onBulkFlag={handleBulkFlag}
        />
      </div>
    </div>
  );
}
