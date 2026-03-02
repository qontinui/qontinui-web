import { Card, CardContent } from "@/components/ui/card";
import {
  Accessibility,
  MousePointerClick,
  Link2,
  Type,
  Image as ImageIcon,
} from "lucide-react";

export function EmptyState() {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardContent className="py-12">
        <div className="text-center">
          <Accessibility className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <h3 className="text-lg font-medium text-text-secondary mb-2">
            No Inspection Results
          </h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Enter a URL and click Inspect, or use Capture Tree to retrieve the
            accessibility tree from the currently connected page.
          </p>
          <div className="flex justify-center gap-4 mt-6">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />
              Buttons
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Link2 className="w-3.5 h-3.5 text-blue-400" />
              Links
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Type className="w-3.5 h-3.5 text-green-400" />
              Inputs
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
              Images
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
