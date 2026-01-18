/**
 * Extraction Method Selector
 *
 * Card-based UI for selecting between extraction methods:
 * - Web Extraction (DOM-based)
 * - UI-TARS Web (Vision-based for websites)
 * - UI-TARS Desktop (Vision-based for native apps)
 * - Image Extraction (Template matching)
 */

"use client";

import { cn } from "@/lib/utils";
import { Globe, Bot, Monitor, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExtractionMethod } from "@/types/extraction-unified";

interface MethodOption {
  id: ExtractionMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  badge?: string;
}

const methodOptions: MethodOption[] = [
  {
    id: "web",
    label: "Web Extraction",
    description: "DOM-based element discovery using Playwright",
    icon: <Globe className="h-8 w-8" />,
    color: "var(--brand-primary)",
  },
  {
    id: "uitars-web",
    label: "UI-TARS (Web)",
    description: "Vision-based extraction for dynamic websites",
    icon: <Bot className="h-8 w-8" />,
    color: "var(--brand-secondary)",
    badge: "AI",
  },
  {
    id: "uitars-desktop",
    label: "UI-TARS (Desktop)",
    description: "Vision-based extraction for native applications",
    icon: <Monitor className="h-8 w-8" />,
    color: "var(--brand-secondary)",
    badge: "AI",
  },
  {
    id: "image",
    label: "Image Extraction",
    description: "Template matching for simple patterns",
    icon: <ImageIcon className="h-8 w-8" />,
    color: "var(--brand-success)",
  },
];

interface ExtractionMethodSelectorProps {
  selectedMethod: ExtractionMethod;
  onMethodChange: (method: ExtractionMethod) => void;
}

export function ExtractionMethodSelector({
  selectedMethod,
  onMethodChange,
}: ExtractionMethodSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono text-text-muted uppercase tracking-wider">
          Select Method
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {methodOptions.map((option) => {
          const isSelected = selectedMethod === option.id;

          return (
            <button
              key={option.id}
              onClick={() => onMethodChange(option.id)}
              className={cn(
                "relative p-4 rounded-lg border-2 transition-all duration-300 text-left group",
                "hover:shadow-lg hover:scale-[1.02]",
                isSelected
                  ? "border-current shadow-lg"
                  : "border-border-subtle hover:border-border-default bg-surface-raised/50"
              )}
              style={
                isSelected
                  ? {
                      borderColor: option.color,
                      backgroundColor: `color-mix(in oklch, ${option.color} 10%, transparent)`,
                      boxShadow: `0 0 20px color-mix(in oklch, ${option.color} 30%, transparent)`,
                    }
                  : undefined
              }
            >
              {/* Badge */}
              {option.badge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "absolute top-2 right-2 text-[10px] px-1.5 py-0",
                    isSelected ? "border-current" : "border-border-default"
                  )}
                  style={isSelected ? { color: option.color } : undefined}
                >
                  {option.badge}
                </Badge>
              )}

              {/* Icon */}
              <div
                className={cn(
                  "mb-3 transition-all duration-300",
                  isSelected && "scale-110"
                )}
                style={{ color: isSelected ? option.color : "var(--text-muted)" }}
              >
                {option.icon}
              </div>

              {/* Label */}
              <h3
                className={cn(
                  "font-semibold text-sm mb-1 transition-colors",
                  isSelected ? "text-current" : "text-text-primary"
                )}
                style={isSelected ? { color: option.color } : undefined}
              >
                {option.label}
              </h3>

              {/* Description */}
              <p className="text-xs text-text-muted line-clamp-2">
                {option.description}
              </p>

              {/* Selection indicator */}
              {isSelected && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg"
                  style={{ backgroundColor: option.color }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
