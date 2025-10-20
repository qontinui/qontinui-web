// components/integration-testing/SnapshotListCard.tsx

'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSnapshotList } from '@/hooks/useSnapshotList';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCw, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { deleteSnapshot } from '@/lib/api/snapshots';
import { toast } from 'sonner';
import type { SnapshotRun } from '@/types/snapshots';

interface SnapshotListCardProps {
  onSelect?: (snapshot: SnapshotRun) => void;
  selectedSnapshotId?: number;
}

export function SnapshotListCard({ onSelect, selectedSnapshotId }: SnapshotListCardProps) {
  const { snapshots, loading, reload } = useSnapshotList({ autoLoad: true });
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleDelete = async (snapshot: SnapshotRun) => {
    if (!confirm(`Delete snapshot ${snapshot.run_id}?`)) {
      return;
    }

    setDeleting(snapshot.id);

    try {
      await deleteSnapshot(snapshot.run_id, false);
      toast.success(`Snapshot ${snapshot.run_id} deleted`);
      await reload();
    } catch (err) {
      toast.error('Failed to delete snapshot');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Available Snapshots</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && snapshots.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No snapshots available</p>
          <p className="text-sm mt-1">Import a snapshot to get started</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              className={`
                border rounded-lg p-4 cursor-pointer transition-all
                ${selectedSnapshotId === snapshot.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
              `}
              onClick={() => onSelect?.(snapshot)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <h4 className="font-medium">{snapshot.run_id}</h4>
                    {snapshot.execution_mode !== 'real' && (
                      <Badge variant="secondary" className="text-xs">
                        {snapshot.execution_mode}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center space-x-4 mt-2 text-sm text-gray-600">
                    <span className="flex items-center space-x-1">
                      {snapshot.successful_actions === snapshot.total_actions ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <span>
                        {snapshot.successful_actions}/{snapshot.total_actions} actions
                      </span>
                    </span>

                    <span>{snapshot.total_screenshots} screenshots</span>

                    <span>{snapshot.patterns_count} patterns</span>
                  </div>

                  {snapshot.tags && snapshot.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {snapshot.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {snapshot.notes && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {snapshot.notes}
                    </p>
                  )}

                  <p className="text-xs text-gray-500 mt-2">
                    {formatDistanceToNow(new Date(snapshot.start_time), {
                      addSuffix: true,
                    })}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(snapshot);
                  }}
                  disabled={deleting === snapshot.id}
                >
                  {deleting === snapshot.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 text-red-600" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
