import React from "react";
import { Upload, Camera, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ImageDimensions } from "../_hooks/useImageUpload";

interface ScreenshotCardProps {
  dataUrl: string | null;
  dimensions: ImageDimensions | null;
  isCapturing: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCapture: () => void;
}

export const ScreenshotCard: React.FC<ScreenshotCardProps> = ({
  dataUrl,
  dimensions,
  isCapturing,
  inputRef,
  onUpload,
  onCapture,
}) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ImageIcon className="w-4 h-4" />
          Screenshot (Search Target)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            className="flex-1"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCapture}
            disabled={isCapturing}
            className="flex-1"
          >
            {isCapturing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Camera className="w-4 h-4 mr-2" />
            )}
            Capture
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onUpload}
        />
        {dataUrl && (
          <div className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element -- Base64 data URL cannot use Next.js Image optimization */}
            <img
              src={dataUrl}
              alt="Screenshot"
              className="w-full rounded border"
            />
            {dimensions && (
              <Badge variant="secondary" className="absolute bottom-2 right-2">
                {dimensions.width} x {dimensions.height}
              </Badge>
            )}
          </div>
        )}
        {!dataUrl && (
          <div className="flex items-center justify-center h-32 border-2 border-dashed rounded-lg text-muted-foreground">
            <span className="text-sm">No screenshot loaded</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
