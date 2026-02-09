"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";

interface GuiWorkflowPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function GuiWorkflowPicker({
  isOpen,
  onClose,
  onSelect,
}: GuiWorkflowPickerProps) {
  // GUI workflows loaded from loaded GUI config - placeholder for now
  return (
    <LibraryPickerBase
      title="Select GUI Workflow"
      isOpen={isOpen}
      onClose={onClose}
      items={[]}
      isLoading={false}
      onSelect={onSelect}
    />
  );
}
