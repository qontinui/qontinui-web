import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";

export interface ImageDimensions {
  width: number;
  height: number;
}

export function useImageUpload() {
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(
    null
  );
  const [templateDataUrl, setTemplateDataUrl] = useState<string | null>(null);
  const [screenshotDimensions, setScreenshotDimensions] =
    useState<ImageDimensions | null>(null);
  const [templateDimensions, setTemplateDimensions] =
    useState<ImageDimensions | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    (
      event: React.ChangeEvent<HTMLInputElement>,
      setDataUrl: (url: string) => void,
      setDimensions: (dims: ImageDimensions) => void
    ) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setDataUrl(dataUrl);

        const img = new Image();
        img.onload = () => {
          setDimensions({ width: img.width, height: img.height });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleScreenshotUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFileUpload(event, setScreenshotDataUrl, setScreenshotDimensions);
    },
    [handleFileUpload]
  );

  const handleTemplateUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFileUpload(event, setTemplateDataUrl, setTemplateDimensions);
    },
    [handleFileUpload]
  );

  const handleCaptureScreenshot = useCallback(async () => {
    setIsCapturing(true);
    try {
      const response = await runnerClient.captureScreenshot();
      if (response.success && response.screenshot_base64) {
        const dataUrl = `data:image/png;base64,${response.screenshot_base64}`;
        setScreenshotDataUrl(dataUrl);
        if (response.width && response.height) {
          setScreenshotDimensions({
            width: response.width,
            height: response.height,
          });
        }
        toast.success("Screenshot captured");
      } else {
        toast.error(response.error || "Failed to capture screenshot");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to capture screenshot"
      );
    } finally {
      setIsCapturing(false);
    }
  }, []);

  const clearAll = useCallback(() => {
    setScreenshotDataUrl(null);
    setTemplateDataUrl(null);
    setScreenshotDimensions(null);
    setTemplateDimensions(null);
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    if (templateInputRef.current) templateInputRef.current.value = "";
  }, []);

  return {
    screenshotDataUrl,
    templateDataUrl,
    screenshotDimensions,
    templateDimensions,
    isCapturing,
    screenshotInputRef,
    templateInputRef,
    handleScreenshotUpload,
    handleTemplateUpload,
    handleCaptureScreenshot,
    clearAll,
  };
}
