"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useMacros } from "@/lib/runner-api";

interface MacroLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function MacroLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: MacroLibraryPickerProps) {
  const { data, isLoading } = useMacros();
  return (
    <LibraryPickerBase
      title="Select Macro"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
