/**
 * Keyboard Shortcuts Dialog
 *
 * Modal displaying all available keyboard shortcuts for the annotation system.
 * Organized into categories: Tools, Selection, Clipboard, History, and View.
 */

"use client";

import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ShortcutItem {
  key: string;
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutItem[];
}

const shortcutCategories: ShortcutCategory[] = [
  {
    title: "Tools",
    shortcuts: [
      { key: "S", description: "Select tool" },
      { key: "D", description: "Draw tool" },
      { key: "X", description: "Delete tool" },
      { key: "P", description: "Pan tool" },
    ],
  },
  {
    title: "Selection",
    shortcuts: [
      { key: "Ctrl+A", description: "Select all" },
      { key: "Escape", description: "Deselect all" },
      { key: "Delete", description: "Delete selected" },
    ],
  },
  {
    title: "Clipboard",
    shortcuts: [
      { key: "Ctrl+C", description: "Copy" },
      { key: "Ctrl+X", description: "Cut" },
      { key: "Ctrl+V", description: "Paste" },
    ],
  },
  {
    title: "History",
    shortcuts: [
      { key: "Ctrl+Z", description: "Undo" },
      { key: "Ctrl+Y", description: "Redo" },
      { key: "Ctrl+S", description: "Save version" },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { key: "Ctrl+G", description: "Toggle grid" },
      { key: "?", description: "Show keyboard shortcuts" },
    ],
  },
];

function ShortcutKey({ keyText }: { keyText: string }) {
  const parts = keyText.split("+");

  return (
    <div className="flex items-center gap-1">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center">
          <kbd className="px-2 py-1 text-xs font-mono font-semibold bg-[#9B59B6]/10 text-[#9B59B6] border border-[#9B59B6]/30 rounded">
            {part}
          </kbd>
          {index < parts.length - 1 && (
            <span className="mx-0.5 text-text-muted">+</span>
          )}
        </span>
      ))}
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutItem }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded hover:bg-surface-hover">
      <span className="text-sm text-text-secondary">
        {shortcut.description}
      </span>
      <ShortcutKey keyText={shortcut.key} />
    </div>
  );
}

function ShortcutSection({ category }: { category: ShortcutCategory }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-[#9B59B6] mb-2 px-3">
        {category.title}
      </h3>
      <div className="space-y-0.5">
        {category.shortcuts.map((shortcut) => (
          <ShortcutRow key={shortcut.key} shortcut={shortcut} />
        ))}
      </div>
    </div>
  );
}

interface KeyboardShortcutsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  showTrigger = true,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-text-muted hover:text-[#9B59B6]"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#9B59B6]">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-4 max-h-[60vh] overflow-y-auto">
          {shortcutCategories.map((category) => (
            <ShortcutSection key={category.title} category={category} />
          ))}
        </div>
        <div className="text-xs text-text-muted text-center pt-2 border-t border-border-subtle">
          Press{" "}
          <kbd className="px-1.5 py-0.5 text-xs font-mono bg-surface-hover rounded">
            ?
          </kbd>{" "}
          anytime to show this dialog
        </div>
      </DialogContent>
    </Dialog>
  );
}
