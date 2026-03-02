import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Download, Image as ImageIcon } from "lucide-react";
import type { DiscoveredState } from "../types";

interface ScreenshotPreviewPanelProps {
  selectedState: DiscoveredState | null;
}

export function ScreenshotPreviewPanel({
  selectedState,
}: ScreenshotPreviewPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Screenshot Preview</CardTitle>
        <CardDescription className="text-xs">
          {selectedState
            ? `Showing representative screenshot #${selectedState.representative_screenshot_id}`
            : "Select a state to view screenshots"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {selectedState ? (
          <div className="space-y-2">
            {/* Screenshot Image Placeholder */}
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border-2 border-dashed">
              <div className="text-center space-y-2">
                <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Screenshot #{selectedState.representative_screenshot_id}
                </p>
                <p className="text-xs text-muted-foreground">
                  Image loading not implemented
                </p>
              </div>
            </div>

            {/* Screenshot Navigation */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                1 of {selectedState.screenshot_ids.length}
              </span>
              <Button variant="outline" size="sm" disabled>
                Next
              </Button>
            </div>

            <Separator />

            {/* Download Actions */}
            <div className="space-y-2">
              <Button variant="outline" size="sm" className="w-full" disabled>
                <Download className="w-4 h-4 mr-2" />
                Download Screenshot
              </Button>
              <Button variant="outline" size="sm" className="w-full" disabled>
                <Download className="w-4 h-4 mr-2" />
                Download All Screenshots
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[600px] text-muted-foreground">
            <div className="text-center space-y-2">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <p className="text-sm">No state selected</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
