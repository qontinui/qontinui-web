/**
 * ExplorationSourceSelector
 *
 * Lets user choose between starting a new exploration or loading a previous session.
 */

import { useState } from "react";
import { Plus, FolderOpen, Compass } from "lucide-react";

interface ExplorationSession {
  id: string;
  name: string;
  targetUrl: string;
  statesFound: number;
  createdAt: string;
}

interface ExplorationSourceSelectorProps {
  sessions: ExplorationSession[];
  onNewExploration: () => void;
  onLoadSession: (sessionId: string) => void;
  isLoading: boolean;
}

export function ExplorationSourceSelector({
  sessions,
  onNewExploration,
  onLoadSession,
  isLoading,
}: ExplorationSourceSelectorProps) {
  const [showSessions, setShowSessions] = useState(false);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-700 bg-neutral-800/50">
      <span className="text-xs text-neutral-400">Source:</span>

      <button
        onClick={onNewExploration}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Exploration
      </button>

      <div className="relative">
        <button
          onClick={() => setShowSessions(!showSessions)}
          disabled={sessions.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-700 text-neutral-300 rounded-md hover:bg-neutral-600 disabled:opacity-50 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          Load Previous Session
          {sessions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-neutral-600 rounded">
              {sessions.length}
            </span>
          )}
        </button>

        {showSessions && sessions.length > 0 && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-neutral-800 border border-neutral-600 rounded-md shadow-lg py-1 min-w-[280px] max-h-[200px] overflow-auto">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onLoadSession(session.id);
                  setShowSessions(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-neutral-700 transition-colors"
              >
                <div className="text-xs text-neutral-200">
                  {session.name || session.targetUrl}
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  {session.statesFound} states &middot;{" "}
                  {new Date(session.createdAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <Compass className="w-3 h-3 animate-spin" />
          Loading...
        </div>
      )}
    </div>
  );
}
