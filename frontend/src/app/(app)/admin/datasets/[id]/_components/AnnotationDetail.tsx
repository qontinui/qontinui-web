"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageCanvas } from "@/components/common/ImageCanvas";
import { ImageIcon, Check, X, Flag, CheckSquare, Square } from "lucide-react";
import { datasetService } from "@/services/dataset-service";
import {
  SOURCE_COLORS,
  REVIEW_STATUS_COLORS,
  annotationsToCanvasBoxes,
} from "../dataset-viewer-utils";
import type { AnnotationDetailProps } from "../dataset-viewer-types";

export function AnnotationDetail({
  selectedImage,
  annotations,
  selectedAnnotation,
  selectedAnnotationIds,
  bulkProcessing,
  datasetId,
  showFilters,
  onSelectAnnotation,
  onApprove,
  onReject,
  onFlag,
  onToggleAnnotationSelection,
  onSelectAllAnnotations,
  onBulkApprove,
  onBulkReject,
  onBulkFlag,
}: AnnotationDetailProps) {
  const canvasBoxes = annotationsToCanvasBoxes(annotations);

  return (
    <div
      className={`col-span-12 ${showFilters ? "lg:col-span-6" : "lg:col-span-7"} overflow-y-auto`}
    >
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50 flex items-center justify-between">
        <span>
          {selectedImage ? selectedImage.filename : "Select an image"}
        </span>
        {selectedImage && (
          <span className="normal-case tracking-normal font-normal">
            {selectedImage.width} x {selectedImage.height}px •{" "}
            {annotations.length} annotation(s)
          </span>
        )}
      </div>
      <div className="p-4">
        {selectedImage ? (
          <div className="space-y-4">
            {/* Canvas */}
            <div className="border rounded-lg overflow-hidden">
              <ImageCanvas
                imageUrl={datasetService.getImageUrl(
                  datasetId,
                  selectedImage.image_hash
                )}
                boxes={canvasBoxes}
                selectedBoxId={selectedAnnotation?.id || null}
                onBoxSelect={(id) => {
                  const ann = annotations.find((a) => a.id === id);
                  onSelectAnnotation(ann || null);
                }}
                readonly
                className="h-[350px]"
              />
            </div>

            {/* Bulk Actions Toolbar */}
            {annotations.length > 0 && (
              <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={onSelectAllAnnotations}
                  >
                    {selectedAnnotationIds.size === annotations.length ? (
                      <CheckSquare className="h-4 w-4 mr-1" />
                    ) : (
                      <Square className="h-4 w-4 mr-1" />
                    )}
                    {selectedAnnotationIds.size === annotations.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                  {selectedAnnotationIds.size > 0 && (
                    <span
                      data-content-role="metric"
                      data-content-label="selected annotations count"
                      className="text-xs text-muted-foreground"
                    >
                      {selectedAnnotationIds.size} selected
                    </span>
                  )}
                </div>
                {selectedAnnotationIds.size > 0 && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-green-600 border-green-600 hover:bg-green-50"
                      onClick={onBulkApprove}
                      disabled={bulkProcessing}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-600 border-red-600 hover:bg-red-50"
                      onClick={onBulkReject}
                      disabled={bulkProcessing}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-yellow-600 border-yellow-600 hover:bg-yellow-50"
                      onClick={onBulkFlag}
                      disabled={bulkProcessing}
                    >
                      <Flag className="h-3 w-3 mr-1" />
                      Flag
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Annotation List */}
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {annotations.map((ann) => (
                  <div
                    key={ann.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedAnnotation?.id === ann.id
                        ? "border-primary bg-accent"
                        : selectedAnnotationIds.has(ann.id)
                          ? "border-blue-300 bg-blue-50 dark:bg-blue-950"
                          : "hover:bg-accent/50"
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectAnnotation(ann)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectAnnotation(ann);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selectedAnnotationIds.has(ann.id)}
                          onCheckedChange={() =>
                            onToggleAnnotationSelection(ann.id)
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: SOURCE_COLORS[ann.source],
                              }}
                            />
                            <span
                              data-content-role="label"
                              data-content-label="annotation category"
                              className="font-medium text-sm"
                            >
                              {ann.category_name}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{
                                borderColor:
                                  REVIEW_STATUS_COLORS[ann.review_status],
                                color: REVIEW_STATUS_COLORS[ann.review_status],
                              }}
                            >
                              {ann.review_status}
                            </Badge>
                          </div>
                          <div
                            data-content-role="metric"
                            data-content-label="annotation details"
                            className="text-xs text-muted-foreground mt-1"
                          >
                            Conf: {(ann.confidence * 100).toFixed(0)}% •{" "}
                            {ann.width}x{ann.height}px •{" "}
                            {ann.element_type || "unknown"}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApprove(ann);
                          }}
                          disabled={ann.review_status === "approved"}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReject(ann);
                          }}
                          disabled={ann.review_status === "rejected"}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFlag(ann);
                          }}
                          disabled={ann.review_status === "flagged"}
                        >
                          <Flag className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[550px] text-muted-foreground">
            <div className="text-center">
              <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Select an image to view annotations</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
