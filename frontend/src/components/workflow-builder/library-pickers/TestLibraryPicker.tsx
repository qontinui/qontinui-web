"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useTests } from "@/lib/runner-api";

interface TestLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function TestLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: TestLibraryPickerProps) {
  const { data, isLoading } = useTests();
  return (
    <LibraryPickerBase
      title="Select Test"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
