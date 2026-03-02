"use client";

import { useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import {
  useExtractionAnnotationStore,
  type ReviewStatus,
} from "@/stores/extraction-annotation-store";
import type { FormValues } from "./_components/element-annotation-form-types";
import { EmptySelectionCard } from "./_components/EmptySelectionCard";
import { MultiSelectForm } from "./_components/MultiSelectForm";
import { SingleElementForm } from "./_components/SingleElementForm";

interface ElementAnnotationFormProps {
  className?: string;
}

export function ElementAnnotationForm({
  className,
}: ElementAnnotationFormProps) {
  const selectedElementIds = useExtractionAnnotationStore(
    (state) => state.selectedElementIds
  );
  const elements = useExtractionAnnotationStore((state) => state.elements);
  const updateElement = useExtractionAnnotationStore(
    (state) => state.updateElement
  );
  const updateElements = useExtractionAnnotationStore(
    (state) => state.updateElements
  );
  const setReviewStatus = useExtractionAnnotationStore(
    (state) => state.setReviewStatus
  );

  const selectedElements = useMemo(
    () => elements.filter((el) => selectedElementIds.includes(el.id)),
    [elements, selectedElementIds]
  );

  const selectedElement = useMemo(
    () => (selectedElements.length === 1 ? selectedElements[0] : null),
    [selectedElements]
  );
  const isMultiSelect = selectedElements.length > 1;

  const { register, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      label: "",
      elementType: "button",
      description: "",
      reasoning: "",
      isGroundTruth: false,
      isClickable: true,
      reviewStatus: "pending",
    },
  });

  useEffect(() => {
    if (selectedElement) {
      reset({
        label: selectedElement.label || "",
        elementType: selectedElement.elementType || "button",
        description: selectedElement.description || "",
        reasoning: selectedElement.reasoning || "",
        isGroundTruth: selectedElement.isGroundTruth || false,
        isClickable: selectedElement.isClickable ?? true,
        reviewStatus: selectedElement.reviewStatus || "pending",
      });
    }
  }, [selectedElement, reset]);

  const watchedValues = watch();

  useEffect(() => {
    if (!selectedElement || isMultiSelect) {
      return;
    }

    const timeout = setTimeout(() => {
      updateElement(selectedElement.id, {
        label: watchedValues.label,
        elementType: watchedValues.elementType,
        description: watchedValues.description || undefined,
        reasoning: watchedValues.reasoning || undefined,
        isGroundTruth: watchedValues.isGroundTruth,
        isClickable: watchedValues.isClickable,
        reviewStatus: watchedValues.reviewStatus,
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [
    watchedValues.label,
    watchedValues.elementType,
    watchedValues.description,
    watchedValues.reasoning,
    watchedValues.isGroundTruth,
    watchedValues.isClickable,
    watchedValues.reviewStatus,
    selectedElement,
    isMultiSelect,
    updateElement,
  ]);

  const handleBulkSetGroundTruth = useCallback(
    (value: boolean) => {
      updateElements(selectedElementIds, { isGroundTruth: value });
    },
    [updateElements, selectedElementIds]
  );

  const handleBulkSetReviewStatus = useCallback(
    (status: ReviewStatus) => {
      setReviewStatus(selectedElementIds, status);
    },
    [setReviewStatus, selectedElementIds]
  );

  const handleBulkSetType = useCallback(
    (type: string) => {
      updateElements(selectedElementIds, { elementType: type });
    },
    [updateElements, selectedElementIds]
  );

  const multiSelectStats = useMemo(() => {
    if (!isMultiSelect) return null;
    return {
      types: Array.from(
        new Set(selectedElements.map((e) => e.elementType))
      ).join(", "),
      groundTruthCount: selectedElements.filter((e) => e.isGroundTruth).length,
      totalCount: selectedElements.length,
    };
  }, [isMultiSelect, selectedElements]);

  if (selectedElements.length === 0) {
    return <EmptySelectionCard className={className} />;
  }

  if (isMultiSelect) {
    return (
      <MultiSelectForm
        className={className}
        selectedCount={selectedElements.length}
        stats={multiSelectStats}
        onBulkSetType={handleBulkSetType}
        onBulkSetGroundTruth={handleBulkSetGroundTruth}
        onBulkSetReviewStatus={handleBulkSetReviewStatus}
      />
    );
  }

  return (
    <SingleElementForm
      className={className}
      element={selectedElement!}
      watchedValues={watchedValues}
      register={register}
      setValue={setValue}
    />
  );
}
