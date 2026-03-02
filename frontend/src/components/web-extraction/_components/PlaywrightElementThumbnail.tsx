import { Image as ImageIcon, CheckCircle2, XCircle } from "lucide-react";
import type { PlaywrightClickable } from "@/lib/runner-client";

interface PlaywrightElementThumbnailProps {
  element: PlaywrightClickable;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isSelected?: boolean;
}

export function PlaywrightElementThumbnail({
  element,
  onMouseEnter,
  onMouseLeave,
  isSelected,
}: PlaywrightElementThumbnailProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        p-2 rounded-lg border cursor-pointer transition-all w-full
        ${
          isSelected
            ? "border-brand-success bg-brand-success/20 shadow-[0_0_12px_rgba(77,184,157,0.2)]"
            : "border-border-subtle bg-surface-canvas/50 hover:border-brand-secondary/50"
        }
      `}
    >
      <div className="aspect-video bg-surface-canvas rounded border border-border-subtle mb-2 overflow-hidden flex items-center justify-center">
        {element.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-brand-secondary/30" />
        )}
      </div>
      <div className="text-[10px] font-semibold text-white truncate">
        {element.text || element.aria_label || `${element.tag_name} element`}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-text-muted font-mono uppercase tracking-wider truncate">
          {element.tag_name}
        </span>
        {element.verified ? (
          <CheckCircle2 className="h-3 w-3 text-brand-success shrink-0" />
        ) : (
          <XCircle className="h-3 w-3 text-error shrink-0" />
        )}
      </div>
    </div>
  );
}
