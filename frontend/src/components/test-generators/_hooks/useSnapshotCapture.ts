import { useState, useCallback } from "react";
import { extensionCommand } from "./useExtensionConnection";
import type { SnapshotData, SnapshotElement } from "../shared/spec-generators";
import type { SnapshotDiff } from "../snapshot/SnapshotComparer";
import type { AnnotationData } from "../snapshot/AnnotationEditor";

interface UseSnapshotCaptureArgs {
  runnerUrl: string;
  selectedTabId: number | null;
  snapshotData: SnapshotData | null;
  setElements: (elements: SnapshotElement[]) => void;
  setSnapshotData: (data: SnapshotData | null) => void;
  setAnnotations: (annotations: Map<string, AnnotationData>) => void;
  setIsConnected: (connected: boolean) => void;
}

export function useSnapshotCapture({
  runnerUrl,
  selectedTabId,
  snapshotData,
  setElements,
  setSnapshotData,
  setAnnotations,
  setIsConnected,
}: UseSnapshotCaptureArgs) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<SnapshotData | null>(
    null
  );
  const [showComparison, setShowComparison] = useState(false);
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);

  const handleCapture = useCallback(async () => {
    setIsCapturing(true);
    setCaptureError(null);
    try {
      if (selectedTabId !== null) {
        await extensionCommand(runnerUrl, "selectTab", {
          tabId: selectedTabId,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await extensionCommand<any>(runnerUrl, "getElements");
      const rawElements = data.elements || [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pageInfo: any = {};
      try {
        pageInfo = await extensionCommand(runnerUrl, "getActiveTab");
      } catch {
        // Page info is optional
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedElements: SnapshotElement[] = rawElements.map((el: any) => {
        const accessibility = el.accessibility || {};
        return {
          id: el.id || "",
          type: el.type || el.tagName || "unknown",
          label:
            el.label || accessibility.accessibleName || el.text || el.id || "",
          role: accessibility.role || el.role,
          ariaLabel: accessibility.ariaLabel || accessibility.accessibleName,
          isInteractive:
            Array.isArray(el.actions) &&
            el.actions.some((a: string) =>
              ["click", "type", "select", "check", "toggle"].includes(a)
            ),
          isVisible: el.visible !== false,
          isEnabled: el.enabled !== false,
          isRequired: accessibility.required || el.required,
          value: el.value,
          checked: el.checked,
          formId: el.formId,
          attributes: el.attributes || el.dataAttributes,
        };
      });

      const formIds = new Set(
        parsedElements.filter((e) => e.formId).map((e) => e.formId!)
      );
      const forms = Array.from(formIds).map((formId) => ({
        id: formId,
        name: formId,
        action: undefined as string | undefined,
        fields: parsedElements.filter((e) => e.formId === formId),
        hasSubmitButton: parsedElements.some(
          (e) =>
            e.formId === formId &&
            (e.type === "submit" || e.role === "button") &&
            /submit|sign|log\s?in|register/i.test(e.label || "")
        ),
      }));

      const modals: SnapshotData["modals"] = [];

      const snapshotDataNew: SnapshotData = {
        elements: parsedElements,
        forms,
        modals,
        pageUrl: pageInfo.url || pageInfo.tab?.url,
        pageTitle: pageInfo.title || pageInfo.tab?.title,
      };

      if (snapshotData) {
        setPreviousSnapshot(snapshotData);
      }

      setElements(parsedElements);
      setSnapshotData(snapshotDataNew);
      setAnnotations(new Map());
      setIsConnected(true);

      if (parsedElements.length === 0) {
        setCaptureError(
          "No elements found. Make sure the target page is loaded and the extension has access."
        );
      }
    } catch (err) {
      console.error("Capture failed:", err);
      setCaptureError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setIsCapturing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerUrl, snapshotData, selectedTabId]);

  const handleCompare = useCallback(() => {
    if (!snapshotData || !previousSnapshot) return;

    const currentIds = new Set(snapshotData.elements.map((e) => e.id));
    const prevIds = new Set(previousSnapshot.elements.map((e) => e.id));

    const added = snapshotData.elements
      .filter((e) => !prevIds.has(e.id))
      .map((e) => ({ id: e.id, label: e.label || e.id, type: e.type }));

    const removed = previousSnapshot.elements
      .filter((e) => !currentIds.has(e.id))
      .map((e) => ({ id: e.id, label: e.label || e.id, type: e.type }));

    const changed: SnapshotDiff["changed"] = [];
    for (const el of snapshotData.elements) {
      const prev = previousSnapshot.elements.find((p) => p.id === el.id);
      if (!prev) continue;
      const changes: string[] = [];
      if (el.isVisible !== prev.isVisible)
        changes.push(`visible: ${prev.isVisible} -> ${el.isVisible}`);
      if (el.isEnabled !== prev.isEnabled)
        changes.push(`enabled: ${prev.isEnabled} -> ${el.isEnabled}`);
      if (el.value !== prev.value)
        changes.push(`value: "${prev.value || ""}" -> "${el.value || ""}"`);
      if (changes.length > 0) {
        changed.push({
          id: el.id,
          label: el.label || el.id,
          type: el.type,
          changes,
        });
      }
    }

    const unchanged = snapshotData.elements.filter(
      (e) => prevIds.has(e.id) && !changed.some((c) => c.id === e.id)
    ).length;

    setSnapshotDiff({ added, removed, changed, unchanged });
    setShowComparison(true);
  }, [snapshotData, previousSnapshot]);

  return {
    isCapturing,
    captureError,
    previousSnapshot,
    showComparison,
    setShowComparison,
    snapshotDiff,
    handleCapture,
    handleCompare,
  };
}
