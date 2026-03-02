import React, { useCallback } from "react";
import { Trash2, Search, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useImageUpload } from "./_hooks/useImageUpload";
import { usePatternSearch } from "./_hooks/usePatternSearch";
import { ScreenshotCard } from "./_components/ScreenshotCard";
import { TemplateCard } from "./_components/TemplateCard";
import { SearchSettingsCard } from "./_components/SearchSettingsCard";
import { ResultsPanel } from "./_components/ResultsPanel";

interface PatternMatchingTestProps {
  className?: string;
}

export const PatternMatchingTest: React.FC<PatternMatchingTestProps> = ({
  className,
}) => {
  const images = useImageUpload();
  const search = usePatternSearch(
    images.screenshotDataUrl,
    images.templateDataUrl
  );

  const handleClear = useCallback(() => {
    images.clearAll();
    search.clearResults();
  }, [images, search]);

  return (
    <div className={cn("flex flex-col h-full gap-4 p-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pattern Matching Test</h2>
          <p className="text-muted-foreground">
            Test template matching via the local runner
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleClear}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
          <Button
            onClick={search.handleSearch}
            disabled={
              !images.screenshotDataUrl ||
              !images.templateDataUrl ||
              search.isSearching
            }
          >
            {search.isSearching ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            {search.config.findAll ? "Find All" : "Find Best"}
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[350px_1fr] gap-4 min-h-0">
        <div className="flex flex-col gap-4 overflow-y-auto">
          <ScreenshotCard
            dataUrl={images.screenshotDataUrl}
            dimensions={images.screenshotDimensions}
            isCapturing={images.isCapturing}
            inputRef={images.screenshotInputRef}
            onUpload={images.handleScreenshotUpload}
            onCapture={images.handleCaptureScreenshot}
          />
          <TemplateCard
            dataUrl={images.templateDataUrl}
            dimensions={images.templateDimensions}
            inputRef={images.templateInputRef}
            onUpload={images.handleTemplateUpload}
          />
          <SearchSettingsCard config={search.config} />
        </div>

        <ResultsPanel
          results={search.results}
          isSearching={search.isSearching}
          similarity={search.config.similarity}
          canvasRef={search.canvasRef}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4" />
        <span>
          Pattern matching uses OpenCV template matching (TM_CCOEFF_NORMED) via
          the local runner.
        </span>
      </div>
    </div>
  );
};

export default PatternMatchingTest;
