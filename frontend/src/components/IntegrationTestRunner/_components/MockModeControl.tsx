import React from "react";
import type { MockMode } from "@/lib/runner-client";

interface MockModeControlProps {
  mockMode: MockMode;
  onSetMode: (mode: MockMode) => void;
}

export function MockModeControl({ mockMode, onSetMode }: MockModeControlProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <h3 className="text-lg font-medium mb-4">Mock Mode</h3>
      <div className="flex gap-2">
        <button
          onClick={() => onSetMode("disabled")}
          className={`flex-1 py-2 rounded border ${
            mockMode === "disabled"
              ? "bg-blue-600 text-white border-blue-600"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
          }`}
        >
          Disabled
        </button>
        <button
          onClick={() => onSetMode("record")}
          className={`flex-1 py-2 rounded border ${
            mockMode === "record"
              ? "bg-yellow-600 text-white border-yellow-600"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
          }`}
        >
          Record
        </button>
        <button
          onClick={() => onSetMode("playback")}
          className={`flex-1 py-2 rounded border ${
            mockMode === "playback"
              ? "bg-green-600 text-white border-green-600"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
          }`}
        >
          Playback
        </button>
      </div>
      <p className="text-sm text-gray-500 mt-2">
        {mockMode === "disabled" &&
          "Actions will execute normally on the screen."}
        {mockMode === "record" && "Actions will be recorded without executing."}
        {mockMode === "playback" &&
          "Actions will be verified against recorded expectations."}
      </p>
    </div>
  );
}
