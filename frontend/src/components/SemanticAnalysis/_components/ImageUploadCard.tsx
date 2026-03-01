"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";

interface ImageUploadCardProps {
  selectedImage: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ImageUploadCard({
  selectedImage,
  fileInputRef,
  onImageUpload,
}: ImageUploadCardProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Image Upload</CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onImageUpload}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          className="w-full border-border-default hover:border-brand-primary"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Screenshot
        </Button>
        {selectedImage && (
          <div className="mt-2 text-xs text-text-muted">
            Image loaded and ready for analysis
          </div>
        )}
      </CardContent>
    </Card>
  );
}
