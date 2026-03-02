"use client";

import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface UploadActionButtonsProps {
  success: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  recordingId: string | null;
  onUpload: () => void;
  onReset: () => void;
  onCancel: () => void;
  onViewRecording: (id: string) => void;
}

export function UploadActionButtons({
  success,
  uploading,
  uploadDisabled,
  recordingId,
  onUpload,
  onReset,
  onCancel,
  onViewRecording,
}: UploadActionButtonsProps) {
  return (
    <div className="flex justify-end space-x-3 pt-4">
      {success ? (
        <>
          <Button variant="outline" onClick={onReset}>
            Upload Another
          </Button>
          <Button onClick={() => recordingId && onViewRecording(recordingId)}>
            View Recording
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={onCancel} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={onUpload} disabled={uploadDisabled}>
            {uploading ? (
              <>Uploading...</>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload Recording
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}
