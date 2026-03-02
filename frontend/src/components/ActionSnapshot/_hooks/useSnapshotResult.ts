import { useState } from "react";

export function useSnapshotResult() {
  const [actionSuccess, setActionSuccess] = useState(true);
  const [resultSuccess, setResultSuccess] = useState(true);
  const [duration, setDuration] = useState(100);
  const [nextScreenshotId, setNextScreenshotId] = useState<
    string | undefined
  >();
  const [showScreenshotSelector, setShowScreenshotSelector] = useState(false);

  const toggleScreenshotSelector = () => {
    setShowScreenshotSelector((prev) => !prev);
  };

  const selectScreenshot = (id: string) => {
    setNextScreenshotId(id);
    setShowScreenshotSelector(false);
  };

  const clearNextScreenshot = () => {
    setNextScreenshotId(undefined);
  };

  return {
    actionSuccess,
    setActionSuccess,
    resultSuccess,
    setResultSuccess,
    duration,
    setDuration,
    nextScreenshotId,
    selectScreenshot,
    clearNextScreenshot,
    showScreenshotSelector,
    toggleScreenshotSelector,
  };
}
