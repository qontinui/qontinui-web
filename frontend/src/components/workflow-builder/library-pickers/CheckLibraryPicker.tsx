"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useChecks } from "@/lib/runner-api";

interface CheckLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function CheckLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: CheckLibraryPickerProps) {
  const { data, isLoading } = useChecks();
  return (
    <LibraryPickerBase
      title="Select Check"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
