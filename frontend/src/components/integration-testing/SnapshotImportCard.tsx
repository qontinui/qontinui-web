// components/integration-testing/SnapshotImportCard.tsx

'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSnapshotImport } from '@/hooks/useSnapshotImport';
import { toast } from 'sonner';
import { Loader2, Upload, FolderOpen } from 'lucide-react';

interface SnapshotImportCardProps {
  onImportSuccess?: () => void;
}

export function SnapshotImportCard({ onImportSuccess }: SnapshotImportCardProps) {
  const [directoryPath, setDirectoryPath] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');

  const { importing, error, importSnapshotDirectory } = useSnapshotImport();

  const handleImport = async () => {
    if (!directoryPath.trim()) {
      toast.error('Please enter a snapshot directory path');
      return;
    }

    try {
      const tagList = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const snapshot = await importSnapshotDirectory({
        snapshot_directory: directoryPath.trim(),
        tags: tagList.length > 0 ? tagList : undefined,
        notes: notes.trim() || undefined,
      });

      toast.success(
        `Snapshot imported successfully: ${snapshot.run_id}`,
        {
          description: `${snapshot.total_actions} actions recorded`,
        }
      );

      // Reset form
      setDirectoryPath('');
      setTags('');
      setNotes('');

      // Notify parent
      onImportSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Import failed', {
        description: errorMessage,
      });
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center space-x-2 mb-4">
        <Upload className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold">Import Snapshot</h3>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Import a recorded snapshot directory to make it available for integration testing.
      </p>

      <div className="space-y-4">
        {/* Directory Path */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
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
              onClick={() => {
                // TODO: Implement file browser dialog
                toast.info('File browser not yet implemented');
              }}
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
          <label className="block text-sm font-medium mb-1.5">
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
          <label className="block text-sm font-medium mb-1.5">
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
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error.message}</p>
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
