"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { usePrompts } from "@/lib/runner-api";

interface PromptLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function PromptLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: PromptLibraryPickerProps) {
  const { data, isLoading } = usePrompts();
  return (
    <LibraryPickerBase
      title="Select Prompt"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
