import { FileImage } from "lucide-react";
import { ExplorerPanelThumbnail } from "@/components/qontinui/ExplorerPanel";

interface PlaywrightScreenshotThumbnailProps {
  screenshotId: string;
  isSelected: boolean;
  screenshotBase64?: string;
  onClick: () => void;
}

export function PlaywrightScreenshotThumbnail({
  screenshotId,
  isSelected,
  screenshotBase64,
  onClick,
}: PlaywrightScreenshotThumbnailProps) {
  return (
    <ExplorerPanelThumbnail
      selected={isSelected}
      accent="primary"
      onClick={onClick}
    >
      <div className="w-full h-full bg-surface-canvas">
        {screenshotBase64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${screenshotBase64}`}
            alt={screenshotId}
            className={`w-full h-full object-cover object-top transition-opacity duration-300 ${
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-100"
            }`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileImage className="h-4 w-4 text-brand-primary/20" />
          </div>
        )}
      </div>
      <div
        className={`p-1.5 ${isSelected ? "bg-brand-primary/20" : "bg-surface-canvas/70"}`}
      >
        <div
          className={`text-[9px] font-mono truncate ${
            isSelected ? "text-brand-primary" : "text-text-muted"
          }`}
        >
          {screenshotId.slice(-8)}
        </div>
      </div>
    </ExplorerPanelThumbnail>
  );
}
