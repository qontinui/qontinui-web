"use client";

import { useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Trash2, User, Loader2 } from "lucide-react";

interface AvatarUploadProps {
  currentAvatarUrl?: string;
  userName: string;
  onUpload: (file: File) => Promise<{ avatar_url: string }>;
  onDelete: () => Promise<void>;
}

export function AvatarUpload({
  currentAvatarUrl,
  userName,
  onUpload,
  onDelete,
}: AvatarUploadProps) {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    // Validate file
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size should be less than 5MB");
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload
    setIsUploading(true);
    try {
      const result = await onUpload(file);
      setAvatarUrl(result.avatar_url);
      setPreviewUrl(null);
      toast.success("Avatar uploaded successfully");
    } catch (error: unknown) {
      setPreviewUrl(null);
      toast.error(
        error instanceof Error ? error.message : "Failed to upload avatar"
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDeleteAvatar = async () => {
    if (!confirm("Are you sure you want to delete your avatar?")) return;

    try {
      await onDelete();
      setAvatarUrl(undefined);
      setPreviewUrl(null);
      toast.success("Avatar deleted successfully");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete avatar"
      );
    }
  };

  const displayUrl = previewUrl || avatarUrl;

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl">Profile Picture</CardTitle>
        <CardDescription>Upload a profile picture or avatar</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-6">
          {/* Avatar Display */}
          <div className="relative">
            <div className="w-32 h-32 rounded-full overflow-hidden bg-gradient-to-br from-brand-primary/20 to-brand-secondary/20 border-2 border-border-default flex items-center justify-center">
              {displayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayUrl}
                  alt={userName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-16 h-16 text-text-muted" />
              )}
            </div>
            {isUploading && (
              <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
              </div>
            )}
          </div>

          {/* Upload Controls */}
          <div className="flex-1 space-y-3">
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragOver
                  ? "border-brand-primary bg-brand-primary/10"
                  : "border-border-default hover:border-border-default"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted mb-2">
                Drag and drop an image here, or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30"
              >
                <Upload className="w-4 h-4 mr-2" />
                Choose File
              </Button>
              <p className="text-xs text-text-muted mt-2">
                PNG, JPG or GIF (max. 5MB)
              </p>
            </div>

            {avatarUrl && (
              <Button
                type="button"
                onClick={handleDeleteAvatar}
                variant="outline"
                className="w-full border-red-500/30 hover:border-red-500 hover:bg-red-500/10 text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove Avatar
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
