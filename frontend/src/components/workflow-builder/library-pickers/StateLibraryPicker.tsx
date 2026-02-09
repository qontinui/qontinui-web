"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";

interface StateLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function StateLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: StateLibraryPickerProps) {
  // States are loaded from the runner's state explorer - placeholder for now
  return (
    <LibraryPickerBase
      title="Select State"
      isOpen={isOpen}
      onClose={onClose}
      items={[]}
      isLoading={false}
      onSelect={onSelect}
    />
  );
}
