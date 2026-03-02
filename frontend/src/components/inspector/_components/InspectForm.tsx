import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ScanSearch, TreePine, AlertCircle } from "lucide-react";

export function InspectForm({
  targetUrl,
  setTargetUrl,
  isInspecting,
  inspectError,
  onInspect,
  onCaptureTree,
}: {
  targetUrl: string;
  setTargetUrl: (url: string) => void;
  isInspecting: boolean;
  inspectError: string | null;
  onInspect: () => void;
  onCaptureTree: () => void;
}) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader>
        <CardTitle className="text-lg text-white flex items-center gap-2">
          <ScanSearch className="w-5 h-5" />
          Inspect Page
        </CardTitle>
        <CardDescription className="text-text-muted">
          Enter a URL to inspect its accessibility tree, or capture the
          currently connected page
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-3">
          <Input
            placeholder="https://example.com"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onInspect()}
            className="flex-1 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
          />
          <Button
            onClick={onInspect}
            disabled={isInspecting || !targetUrl.trim()}
            className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold px-6"
          >
            {isInspecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Inspecting...
              </>
            ) : (
              <>
                <ScanSearch className="w-4 h-4 mr-2" />
                Inspect
              </>
            )}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border-subtle/30" />
          <span className="text-xs text-text-muted">or</span>
          <div className="h-px flex-1 bg-border-subtle/30" />
        </div>
        <Button
          variant="outline"
          onClick={onCaptureTree}
          disabled={isInspecting}
          className="w-full border-border-subtle/50 text-text-secondary hover:text-white hover:bg-surface-hover"
        >
          <TreePine className="w-4 h-4 mr-2" />
          Capture Tree from Connected Page (CDP)
        </Button>

        {inspectError && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{inspectError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
