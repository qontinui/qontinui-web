"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useCheckGroups } from "@/lib/runner-api";

interface CheckGroupLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function CheckGroupLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: CheckGroupLibraryPickerProps) {
  const { data, isLoading } = useCheckGroups();
  return (
    <LibraryPickerBase
      title="Select Check Group"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
