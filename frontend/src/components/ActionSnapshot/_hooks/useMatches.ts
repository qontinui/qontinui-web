import { useState } from "react";
import { Match } from "../types";

export function useMatches() {
  const [matches, setMatches] = useState<Match[]>([]);

  const addMatch = () => {
    setMatches((prev) => [
      ...prev,
      {
        region: { x: 0, y: 0, width: 100, height: 100 },
        score: 0.95,
        stateImageId: undefined,
      },
    ]);
  };

  const updateMatch = (
    index: number,
    field: string,
    value: number | string
  ) => {
    setMatches((prev) => {
      const updated = [...prev];
      if (field.includes(".")) {
        const parts = field.split(".");
        const parent = parts[0];
        const child = parts[1];
        if (parent && child) {
          const match = updated[index];
          if (!match) return prev;
          const matchRecord = match as unknown as Record<
            string,
            Record<string, unknown>
          >;
          const parentObj = matchRecord[parent];
          if (parentObj) {
            parentObj[child] = value;
          }
        }
      } else {
        const match = updated[index];
        if (!match) return prev;
        (match as unknown as Record<string, number | string>)[field] = value;
      }
      return updated;
    });
  };

  const removeMatch = (index: number) => {
    setMatches((prev) => prev.filter((_, i) => i !== index));
  };

  return { matches, addMatch, updateMatch, removeMatch };
}
