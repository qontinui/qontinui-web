"use client";

import type { DiscoveredState } from "@/types/state-machine";
import { Grid3X3 } from "lucide-react";

interface CooccurrenceMatrixProps {
  elementToRenders: Record<string, string[]>;
  states: DiscoveredState[];
}

export function CooccurrenceMatrix({
  elementToRenders,
  states: _states,
}: CooccurrenceMatrixProps) {
  // Get elements that appear in at least 2 renders (interesting for co-occurrence)
  const elements = Object.entries(elementToRenders)
    .filter(([, renders]) => renders.length >= 2)
    .slice(0, 20); // Limit for display

  if (elements.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-text-muted">
        <div className="text-center">
          <Grid3X3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No co-occurrence data available</p>
        </div>
      </div>
    );
  }

  // Calculate co-occurrence between elements
  const calculateCooccurrence = (
    el1Renders: string[],
    el2Renders: string[]
  ) => {
    const intersection = el1Renders.filter((r) => el2Renders.includes(r));
    const union = [...new Set([...el1Renders, ...el2Renders])];
    return union.length > 0 ? intersection.length / union.length : 0;
  };

  return (
    <div className="overflow-x-auto">
      <div className="text-sm text-text-muted mb-4">
        Showing top {elements.length} elements by render count. Higher values
        indicate elements that frequently appear together.
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left font-medium"></th>
            {elements.map(([id]) => (
              <th
                key={id}
                className="p-1 text-center font-medium max-w-[60px] truncate"
                title={id}
              >
                {id.slice(0, 8)}...
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {elements.map(([id1, renders1]) => (
            <tr key={id1}>
              <td
                className="p-1 font-medium truncate max-w-[100px]"
                title={id1}
              >
                {id1.slice(0, 12)}...
              </td>
              {elements.map(([id2, renders2]) => {
                const cooc = calculateCooccurrence(renders1, renders2);
                return (
                  <td
                    key={id2}
                    className="p-1 text-center"
                    style={{
                      backgroundColor:
                        id1 === id2
                          ? "transparent"
                          : `rgba(155, 89, 182, ${cooc * 0.5})`,
                    }}
                    title={`${id1} + ${id2}: ${Math.round(cooc * 100)}%`}
                  >
                    {id1 === id2 ? "-" : Math.round(cooc * 100)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
