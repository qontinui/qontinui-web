"use client";

import React, { useMemo } from "react";
import { useMcpServers } from "@/lib/runner-api";
import { LibraryPickerBase } from "./LibraryPickerBase";

interface McpServerToolPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string; description?: string }) => void;
}

export function McpServerToolPicker({
  isOpen,
  onClose,
  onSelect,
}: McpServerToolPickerProps) {
  const { data: servers, isLoading } = useMcpServers();

  const items = useMemo(() => {
    if (!servers) return [];
    return servers
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.transport,
        description: s.description,
      }));
  }, [servers]);

  return (
    <LibraryPickerBase
      title="Select MCP Server"
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      isLoading={isLoading}
      onSelect={onSelect}
    />
  );
}
