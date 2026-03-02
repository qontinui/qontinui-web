import React from "react";
import { Upload, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ImageDimensions } from "../_hooks/useImageUpload";

interface TemplateCardProps {
  dataUrl: string | null;
  dimensions: ImageDimensions | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  dataUrl,
  dimensions,
  inputRef,
  onUpload,
}) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4" />
          Template (Pattern to Find)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="w-full"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Template
        </Button>
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
              alt="Template"
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
          <div className="flex items-center justify-center h-24 border-2 border-dashed rounded-lg text-muted-foreground">
            <span className="text-sm">No template loaded</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
