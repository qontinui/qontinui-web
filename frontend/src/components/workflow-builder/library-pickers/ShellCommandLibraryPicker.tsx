"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { useShellCommands } from "@/lib/runner-api";

interface ShellCommandLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function ShellCommandLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: ShellCommandLibraryPickerProps) {
  const { data, isLoading } = useShellCommands();
  return (
    <LibraryPickerBase
      title="Select Shell Command"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
