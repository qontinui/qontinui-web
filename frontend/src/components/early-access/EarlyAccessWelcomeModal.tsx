"use client";

import React, { useState, useEffect } from "react";
import {
  Check,
  AlertCircle,
  Download,
  RefreshCw,
  Lightbulb,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Early Access Welcome Modal
 *
 * One-time modal shown on first login to educate users about early access.
 * Highlights export functionality and sets expectations.
 *
 * Based on: EARLY-ACCESS-WARNING-IMPLEMENTATION.md lines 98-123
 */

const WELCOME_STORAGE_KEY = "qontinui-early-access-welcome-shown";

interface EarlyAccessWelcomeModalProps {
  open?: boolean;
  onClose?: () => void;
  onShowExport?: () => void;
}

export function EarlyAccessWelcomeModal({
  open: controlledOpen,
  onClose,
  onShowExport,
}: EarlyAccessWelcomeModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Use controlled open if provided, otherwise use internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  useEffect(() => {
    // Only auto-show if not controlled and hasn't been shown before
    if (controlledOpen === undefined) {
      const hasShown = localStorage.getItem(WELCOME_STORAGE_KEY);
      if (!hasShown) {
        // Small delay to let dashboard load first
        const timer = setTimeout(() => {
          setInternalOpen(true);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [controlledOpen]);

  const handleClose = () => {
    // Mark as shown
    localStorage.setItem(WELCOME_STORAGE_KEY, "true");

    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  const handleShowExport = () => {
    // Mark as shown
    localStorage.setItem(WELCOME_STORAGE_KEY, "true");

    if (onShowExport) {
      onShowExport();
    } else {
      // Fallback: just close
      console.log("Show export functionality - please wire up handler");
    }

    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-w-2xl border-border-subtle/50 p-0 overflow-hidden",
          "bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas",
          "shadow-[0_0_50px_rgba(59,130,246,0.2)]"
        )}
        showCloseButton={false}
        data-ui-id="dialog-early-access-welcome"
      >
        {/* Glow Effects */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
          <div
            className="absolute bottom-0 left-0 w-96 h-96 bg-green-500/10 rounded-full blur-[120px] animate-pulse"
            style={{ animationDelay: "1s" }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 p-8">
          {/* Header */}
          <DialogHeader className="text-center mb-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-green-500/20 flex items-center justify-center border border-blue-500/30">
                <Rocket className="w-8 h-8 text-blue-400" />
              </div>
            </div>
            <DialogTitle className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 via-green-400 to-blue-400 bg-clip-text text-transparent">
              Welcome to Qontinui Early Access! 🎉
            </DialogTitle>
            <DialogDescription className="text-text-secondary text-base">
              Thanks for being an early tester! Here&apos;s what you need to
              know:
            </DialogDescription>
          </DialogHeader>

          {/* Key Points */}
          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
              <Check className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
              <span className="text-text-secondary">
                Everything works - build your automations now
              </span>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <Download className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <span className="text-text-secondary">
                Export JSON after each session (sidebar export icon or canvas
                button)
              </span>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <span className="text-text-secondary">
                Breaking changes may happen before Feb 2026 launch
              </span>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
              <RefreshCw className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
              <span className="text-text-secondary">
                Exports are versioned (v2.0) with migration tools for format
                changes
              </span>
            </div>
          </div>

          {/* Pro Tip Section */}
          <div className="bg-gradient-to-r from-blue-500/10 to-green-500/10 border border-blue-500/30 rounded-lg p-5 mb-6">
            <div className="flex items-start gap-3 mb-3">
              <Lightbulb className="h-6 w-6 text-yellow-400 flex-shrink-0" />
              <h3 className="text-lg font-semibold text-white">💡 Pro Tip</h3>
            </div>
            <p className="text-text-secondary text-sm mb-3">
              Export your work regularly! We&apos;ve made it easy:
            </p>
            <ul className="space-y-1.5 text-sm text-text-secondary ml-9">
              <li>
                • Click the export icon in the sidebar or use the Export button
                at the top of the canvas
              </li>
              <li>• Keep these files safe (Dropbox, Git, local folder)</li>
              <li>
                • Import anytime using the import icon in the sidebar or Import
                button
              </li>
            </ul>
            <p className="text-text-muted text-sm mt-3 ml-9 italic">
              Think of Export like &quot;Save&quot; - do it often! Files are
              versioned (v2.0) and migration tools will be provided if format
              changes.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleShowExport}
              className={cn(
                "flex-1 h-12 text-base font-semibold",
                "bg-gradient-to-r from-blue-500 to-blue-600",
                "hover:from-blue-600 hover:to-blue-700",
                "text-white shadow-[0_0_20px_rgba(59,130,246,0.3)]",
                "transition-all duration-300"
              )}
              data-ui-id="dialog-early-access-welcome-export-btn"
            >
              <Download className="mr-2 h-5 w-5" />
              Show Me Export
            </Button>
            <Button
              onClick={handleClose}
              variant="outline"
              className={cn(
                "flex-1 h-12 text-base font-semibold",
                "bg-transparent border-border-default hover:border-brand-success",
                "text-text-secondary hover:text-brand-success hover:bg-brand-success/10",
                "transition-all duration-300"
              )}
              data-ui-id="dialog-early-access-welcome-close-btn"
            >
              Got it, let&apos;s build!
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
