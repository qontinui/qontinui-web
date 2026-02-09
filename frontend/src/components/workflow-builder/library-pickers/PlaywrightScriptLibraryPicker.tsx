"use client";

import React from "react";
import { LibraryPickerBase } from "./LibraryPickerBase";
import { usePlaywrightScripts } from "@/lib/runner-api";

interface PlaywrightScriptLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function PlaywrightScriptLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: PlaywrightScriptLibraryPickerProps) {
  const { data, isLoading } = usePlaywrightScripts();
  return (
    <LibraryPickerBase
      title="Select Playwright Script"
      isOpen={isOpen}
      onClose={onClose}
      items={data}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
