import { useState, useCallback } from "react";
import { createLogger } from "@/lib/logger";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";

const logger = createLogger("PatternExtraction");
import type {
  Region,
  ExtractedPattern,
  ExtractionConfig,
  PatternSession,
} from "@/types/pattern-optimization";

function extractRegion(dataUrl: string, region: Region): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const ctx = canvas.getContext("2d");

      ctx?.drawImage(
        img,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height
      );

      const croppedDataUrl = canvas.toDataURL("image/png");
      resolve(croppedDataUrl);
    };
    img.src = dataUrl;
  });
}

export function usePatternExtraction(
  session: PatternSession | null,
  setSession: React.Dispatch<React.SetStateAction<PatternSession | null>>
) {
  const [isExtracting, setIsExtracting] = useState(false);

  const extractPattern = useCallback(
    async (config: ExtractionConfig) => {
      if (!session || session.screenshots.length === 0) {
        throw new Error("No screenshots to extract pattern from");
      }

      // Check that all screenshots have regions
      const screenshotsWithRegions = session.screenshots.filter(
        (s) => s.region
      );
      if (screenshotsWithRegions.length === 0) {
        throw new Error("No regions selected for pattern extraction");
      }

      logger.debug("Extracting pattern with config:", config);
      setIsExtracting(true);

      setSession((prev) => (prev ? { ...prev, status: "extracting" } : prev));

      try {
        // Prepare cropped regions only (not full screenshots)
        const screenshots: string[] = [];
        const regions: {
          x: number;
          y: number;
          width: number;
          height: number;
        }[] = [];

        for (const screenshot of screenshotsWithRegions) {
          // Retrieve image from IndexedDB
          const imageData = await patternOptimizationStorage.getImage(
            screenshot.id
          );
          if (imageData && screenshot.region) {
            // Extract only the region, not the full image
            const croppedImage = await extractRegion(
              imageData,
              screenshot.region
            );
            const base64Data = croppedImage.split(",")[1] ?? "";
            screenshots.push(base64Data);

            // Since we're sending cropped regions, the coordinates are now relative to the crop
            regions.push({
              x: 0,
              y: 0,
              width: Math.round(screenshot.region.width),
              height: Math.round(screenshot.region.height),
            });
          }
        }

        logger.debug(`Sending ${screenshots.length} cropped regions`);

        // Call API for pattern extraction
        logger.debug("Sending API request to extract pattern...");
        const requestBody = {
          state_image_id: "temp", // Not used in our simplified version
          pattern_name: `Pattern_${session.id}`,
          config: {
            similarityThreshold: config.similarityThreshold,
            minActivePixels: config.minActivePixels,
            colorAveraging: config.colorAveraging,
            morphologicalOps: config.morphologicalOps,
          },
          screenshots,
          regions,
        };
        // Calculate request size
        const requestSize = JSON.stringify(requestBody).length;
        logger.debug(
          "Request size:",
          (requestSize / 1024 / 1024).toFixed(2),
          "MB"
        );
        logger.debug("Request body summary:", {
          screenshots: requestBody.screenshots.length,
          screenshotSizes: requestBody.screenshots.map(
            (s) => (s.length / 1024).toFixed(1) + "KB"
          ),
          regions: requestBody.regions,
          config: requestBody.config,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          logger.error("Aborting request due to timeout");
          controller.abort();
        }, 60000); // 60 second timeout

        let response;
        try {
          logger.debug(
            "Sending fetch request to:",
            "http://localhost:8000/api/masked-patterns/extract-masked"
          );

          // Now send the actual request (using relative path through proxy)
          logger.debug("Sending actual POST request...");
          response = await fetch("/api/masked-patterns/extract-masked", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          logger.debug("Fetch completed successfully");
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);
          logger.error("Fetch error:", fetchError);
          logger.error(
            "Error stack:",
            fetchError instanceof Error ? fetchError.stack : ""
          );
          if (fetchError instanceof Error && fetchError.name === "AbortError") {
            throw new Error("Request timed out after 60 seconds");
          }
          throw fetchError;
        } finally {
          clearTimeout(timeoutId);
        }

        logger.debug(
          "API response status:",
          response.status,
          response.statusText
        );
        logger.debug("Response headers:", response.headers);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("API error response:", errorText);
          throw new Error(
            `API request failed: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        let result;
        try {
          const responseText = await response.text();
          logger.debug("Raw response text length:", responseText.length);
          result = JSON.parse(responseText);
          logger.info("Pattern extracted successfully:", result);
        } catch (parseError) {
          logger.error("Failed to parse response:", parseError);
          throw new Error("Failed to parse API response");
        }

        // Get detailed pattern data including images
        const detailsResponse = await fetch(
          `/api/masked-patterns/${result.id}`
        );
        if (!detailsResponse.ok) {
          throw new Error(
            `Failed to get pattern details: ${detailsResponse.statusText}`
          );
        }
        const details = await detailsResponse.json();
        logger.debug("Pattern details:", details);

        // Create ExtractedPattern object
        const extractedPattern: ExtractedPattern = {
          id: result.id,
          name: result.name,
          width: result.width,
          height: result.height,
          patternImage: details.pattern_image || "",
          confidenceMap: details.confidence_image || "",
          maskImage: details.mask_image || "",
          maskDensity: result.maskDensity,
          activePixels: result.activePixels,
          totalPixels: result.totalPixels,
          minConfidence: result.minConfidence,
          maxConfidence: result.maxConfidence,
          avgConfidence: result.avgConfidence,
          stdDevConfidence: result.stdDevConfidence,
          config,
          sourceScreenshotIds: screenshotsWithRegions.map((s) => s.id),
          createdAt: new Date(),
        };

        setSession((prev) =>
          prev
            ? {
                ...prev,
                extractedPattern,
                status: "complete",
                updatedAt: new Date(),
              }
            : prev
        );

        logger.info(
          "Extraction successful! Pattern saved to session:",
          extractedPattern
        );
      } catch (error: unknown) {
        logger.error("Extraction failed:", error);

        if (error instanceof Error && error.name === "AbortError") {
          logger.error("Request timed out after 60 seconds");
        }

        logger.error("Error details:", {
          name: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : "",
        });
        setSession((prev) => (prev ? { ...prev, status: "error" } : prev));
        throw error;
      } finally {
        setIsExtracting(false);
        logger.debug("Extraction finished, isExtracting set to false");
      }
    },
    [session, setSession]
  );

  return { isExtracting, extractPattern };
}
