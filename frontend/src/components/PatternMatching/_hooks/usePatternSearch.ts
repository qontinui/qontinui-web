import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  runnerClient,
  type PatternMatch,
  type PatternMatchResponse,
} from "@/lib/runner-client";

export interface SearchConfig {
  similarity: number;
  setSimilarity: (value: number) => void;
  findAll: boolean;
  setFindAll: (value: boolean) => void;
  maxMatches: number;
  setMaxMatches: (value: number) => void;
}

export function usePatternSearch(
  screenshotDataUrl: string | null,
  templateDataUrl: string | null
) {
  const [similarity, setSimilarity] = useState(0.8);
  const [findAll, setFindAll] = useState(false);
  const [maxMatches, setMaxMatches] = useState(100);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<PatternMatchResponse | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleSearch = useCallback(async () => {
    if (!screenshotDataUrl || !templateDataUrl) {
      toast.error("Please provide both screenshot and template images");
      return;
    }

    setIsSearching(true);
    setResults(null);

    try {
      const screenshotBase64 =
        screenshotDataUrl.split(",")[1] ?? screenshotDataUrl;
      const templateBase64 = templateDataUrl.split(",")[1] ?? templateDataUrl;

      const response = findAll
        ? await runnerClient.patternFindAll({
            screenshot: screenshotBase64,
            template: templateBase64,
            similarity,
            max_matches: maxMatches,
          })
        : await runnerClient.patternFind({
            screenshot: screenshotBase64,
            template: templateBase64,
            similarity,
          });

      setResults(response);

      if (response.success) {
        if (response.matches.length > 0) {
          toast.success(
            `Found ${response.matches.length} match${response.matches.length !== 1 ? "es" : ""}`
          );
        } else {
          toast.info("No matches found above threshold");
        }
      } else {
        toast.error(response.error || "Pattern matching failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Pattern matching failed"
      );
    } finally {
      setIsSearching(false);
    }
  }, [screenshotDataUrl, templateDataUrl, similarity, findAll, maxMatches]);

  const renderMatches = useCallback(
    (matches: PatternMatch[]) => {
      const canvas = canvasRef.current;
      if (!canvas || !screenshotDataUrl) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        matches.forEach((match, index) => {
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 3;
          ctx.strokeRect(match.x, match.y, match.width, match.height);

          ctx.fillStyle = "#ff0000";
          ctx.beginPath();
          ctx.arc(match.center_x, match.center_y, 5, 0, 2 * Math.PI);
          ctx.fill();

          ctx.fillStyle = "#00ff00";
          ctx.font = "14px monospace";
          ctx.fillRect(match.x, match.y - 20, 80, 18);
          ctx.fillStyle = "#000000";
          ctx.fillText(
            `${(match.similarity * 100).toFixed(1)}%`,
            match.x + 4,
            match.y - 6
          );

          if (matches.length > 1) {
            ctx.fillStyle = "#ff0000";
            ctx.fillRect(match.x + match.width - 20, match.y, 20, 18);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(
              `${index + 1}`,
              match.x + match.width - 15,
              match.y + 14
            );
          }
        });
      };
      img.src = screenshotDataUrl;
    },
    [screenshotDataUrl]
  );

  React.useEffect(() => {
    if (results?.matches && results.matches.length > 0) {
      renderMatches(results.matches);
    }
  }, [results, renderMatches]);

  const clearResults = useCallback(() => {
    setResults(null);
  }, []);

  const config: SearchConfig = {
    similarity,
    setSimilarity,
    findAll,
    setFindAll,
    maxMatches,
    setMaxMatches,
  };

  return {
    config,
    isSearching,
    results,
    canvasRef,
    handleSearch,
    clearResults,
  };
}
