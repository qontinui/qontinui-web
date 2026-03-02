import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Database } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { SnapshotRunListProps } from "../snapshot-selector-types";

const SnapshotRunList: React.FC<SnapshotRunListProps> = ({
  snapshots,
  snapshotsLoading,
  selectedSnapshot,
  onSelectSnapshot,
  thumbnailCache,
  loadingThumbnails,
}) => {
  if (snapshotsLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No snapshots found</p>
        <p className="text-xs mt-1">Import snapshots first</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[540px]">
      <div className="space-y-2">
        {snapshots.map((snapshot) => {
          const thumbnails = thumbnailCache.get(snapshot.run_id);
          const isLoadingThumbs = loadingThumbnails.has(snapshot.run_id);

          return (
            <div
              key={snapshot.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSnapshot(snapshot)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectSnapshot(snapshot);
                }
              }}
              className={`
                p-3 rounded-lg border cursor-pointer transition-all
                ${
                  selectedSnapshot?.id === snapshot.id
                    ? "bg-blue-50 border-blue-300 ring-1 ring-blue-300"
                    : "bg-white border-border-subtle hover:border-border-default hover:bg-surface-raised/80"
                }
              `}
            >
              <div className="text-sm font-medium truncate">
                {snapshot.run_id.substring(0, 12)}...
              </div>
              <div className="text-xs text-text-muted mt-1">
                {formatDistanceToNow(new Date(snapshot.start_time), {
                  addSuffix: true,
                })}
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-text-secondary">
                <span>{snapshot.total_screenshots} screenshots</span>
                <span>&bull;</span>
                <span>{snapshot.total_actions} actions</span>
              </div>

              {isLoadingThumbs && (
                <div className="mt-2 flex items-center gap-1 text-xs text-text-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading previews...</span>
                </div>
              )}

              {thumbnails && thumbnails.thumbnails.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="grid grid-cols-4 gap-1">
                    {thumbnails.thumbnails.map((thumb, idx) => (
                      <TooltipProvider key={idx}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="aspect-video bg-surface-raised rounded overflow-hidden border border-border-subtle">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={thumb.url}
                                alt={`Thumbnail ${idx + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div className="font-semibold mb-1">
                                Action {thumb.action_number}
                              </div>
                              {thumb.active_states.length > 0 && (
                                <div className="text-text-secondary">
                                  States: {thumb.active_states.join(", ")}
                                </div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                  {thumbnails.total_screenshots > 4 && (
                    <div className="text-xs text-text-muted text-center">
                      +{thumbnails.total_screenshots - 4} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};

export default SnapshotRunList;
