/**
 * PackageCard renders only what the payload carries: an installation names
 * no category, author or download count, so the card shows none of them
 * rather than "Other", an empty byline, or 0 downloads.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CodePackage } from "@/types/code-packages";

import { PackageCard } from "./PackageCard";

const base: CodePackage = {
  id: "7",
  slug: "data-extractor",
  name: "Data Extractor",
  description: "Extracts data",
  tags: [],
  visibility: "public",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  weekly_downloads: 0,
  average_rating: 0,
  rating_count: 0,
  fork_count: 0,
  star_count: 0,
  verified: false,
  featured: false,
  deprecated: false,
  function_name: "",
};

describe("PackageCard", () => {
  it("hides category, author and downloads the payload does not carry", () => {
    render(<PackageCard package={base} />);

    expect(screen.getByText("Data Extractor")).toBeInTheDocument();
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.queryByText("by")).toBeNull();
    expect(document.querySelector('[title$="total downloads"]')).toBeNull();
  });

  it("shows them when served", () => {
    render(
      <PackageCard
        package={{
          ...base,
          category: "data-processing",
          author: { id: "a", username: "alice", verified: false, staff: false },
          total_downloads: 1234,
        }}
      />
    );

    expect(screen.getByText("Data Processing")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(
      document.querySelector('[title="1234 total downloads"]')
    ).not.toBeNull();
  });
});
