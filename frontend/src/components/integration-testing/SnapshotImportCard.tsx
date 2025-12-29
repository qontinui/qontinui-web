// components/integration-testing/SnapshotImportCard.tsx

"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSnapshotImport } from "@/hooks/useSnapshotImport";
import { toast } from "sonner";
import { Loader2, Upload, FolderOpen } from "lucide-react";

interface SnapshotImportCardProps {
  onImportSuccess?: () => void;
}

export function SnapshotImportCard({
  onImportSuccess,
}: SnapshotImportCardProps) {
  const [directoryPath, setDirectoryPath] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const { importing, error, importSnapshotDirectory } = useSnapshotImport();

  const handleBrowseDirectory = () => {
    // Create a hidden input element for directory selection
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    // @ts-expect-error - directory is not in standard types but widely supported
    input.directory = true;

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        // Get the directory path from the first file
        // In browser context, we get relative path; for actual import,
        // users need to enter the absolute server path
        const firstFile = files[0];
        // @ts-expect-error - webkitRelativePath exists on File in browsers
        const relativePath = firstFile.webkitRelativePath || firstFile.name;
        const dirPath = relativePath.split("/")[0];

        toast.info(
          "Browser directory picker selected a local path. " +
            "Please enter the absolute path on the server where snapshots are stored.",
          { duration: 5000 }
        );

        // Set a helpful hint in the input
        setDirectoryPath(`/path/to/${dirPath}`);
      }
    };

    input.click();
  };

  const handleImport = async () => {
    if (!directoryPath.trim()) {
      toast.error("Please enter a snapshot directory path");
      return;
    }

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const snapshot = await importSnapshotDirectory({
        snapshot_directory: directoryPath.trim(),
        tags: tagList.length > 0 ? tagList : undefined,
        notes: notes.trim() || undefined,
      });

      toast.success(`Snapshot imported successfully: ${snapshot.run_id}`, {
        description: `${snapshot.total_actions} actions recorded`,
      });

      // Reset form
      setDirectoryPath("");
      setTags("");
      setNotes("");

      // Notify parent
      onImportSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error("Import failed", {
        description: errorMessage,
      });
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Upload className="w-5 h-5 text-[#00D9FF]" />
        <h3 className="text-lg font-semibold">Import Snapshot</h3>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        Import a recorded snapshot directory to make it available for
        integration testing.
      </p>

      <div className="space-y-4">
        {/* Directory Path */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Snapshot Directory *
          </label>
          <div className="flex space-x-2">
            <Input
              type="text"
              value={directoryPath}
              onChange={(e) => setDirectoryPath(e.target.value)}
              placeholder="/path/to/snapshots/run-YYYYMMDD-HHMMSS"
              className="flex-1"
              disabled={importing}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={importing}
              onClick={handleBrowseDirectory}
              title="Browse for directory (reminder: enter server path)"
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Absolute path to the snapshot directory
          </p>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Tags (optional)
          </label>
          <Input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="login, authentication, stable"
            disabled={importing}
          />
          <p className="text-xs text-gray-500 mt-1">
            Comma-separated tags for categorization
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Notes (optional)
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this snapshot..."
            rows={3}
            disabled={importing}
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-950/30 border border-red-800 rounded-lg">
            <p className="text-sm text-red-400">{error.message}</p>
          </div>
        )}

        {/* Import Button */}
        <Button
          onClick={handleImport}
          disabled={!directoryPath.trim() || importing}
          className="w-full"
        >
          {importing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Import Snapshot
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
