"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useUnifiedWorkflows } from "@/lib/runner-api";

interface WorkflowLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function WorkflowLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: WorkflowLibraryPickerProps) {
  const { data, isLoading } = useUnifiedWorkflows();
  return (
    <LibraryPickerBase
      title="Select Workflow"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
