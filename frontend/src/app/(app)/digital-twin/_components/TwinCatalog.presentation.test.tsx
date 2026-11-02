/**
 * The queryable-surface catalog's two failure arms, in both modes (plan
 * `2026-10-23-console-presentation-spaces` D3.3): the read itself failing,
 * and the backend's degraded envelope carrying coord's own error text. The
 * operator reads both texts; an evaluator reads the HTTP status, or a fixed
 * sentence, and nothing upstream wrote.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";

const state = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>,
}));

vi.mock("../_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => state.catalog,
}));

import { TwinCatalog } from "./TwinCatalog";

/** A host and a client named only in upstream error text. */
const HOST = "coord.internal.acme-corp.example";
const FORBIDDEN = [HOST, "acme"];

const failedRead = () => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error: new Error(
    `GET /api/v1/digital-twin/catalog failed: 502 - upstream https://${HOST}:8443 refused the connection for Acme Corp`
  ),
});

const coordDown = () => ({
  data: {
    entries: [],
    total: 0,
    coord_error: `Coord unreachable: https://${HOST}:8443 (Acme Corp)`,
  },
  isLoading: false,
  isError: false,
  error: null,
});

beforeEach(() => {
  state.catalog = failedRead();
});

describe("TwinCatalog — a failed read", () => {
  it("gives the operator the failing read's own message", () => {
    render(<TwinCatalog />);
    expect(screen.getByTestId("twin-catalog-error")).toHaveTextContent(HOST);
  });

  it("says only its HTTP status in presentation mode", () => {
    const view = renderInPresentationMode(<TwinCatalog />);
    expect(screen.getByTestId("twin-catalog-error")).toHaveTextContent(
      /^Couldn't load the catalog \(HTTP 502\)\.$/
    );
    expectPresentationSafe(view, { forbidden: FORBIDDEN });
  });
});

describe("TwinCatalog — coord unavailable (the degraded envelope)", () => {
  it("gives the operator coord's own error text", () => {
    state.catalog = coordDown();
    render(<TwinCatalog />);
    expect(screen.getByTestId("twin-catalog-coord-error")).toHaveTextContent(
      HOST
    );
  });

  it("says a fixed sentence in presentation mode", () => {
    state.catalog = coordDown();
    const view = renderInPresentationMode(<TwinCatalog />);
    expect(screen.getByTestId("twin-catalog-coord-error")).toHaveTextContent(
      /^Coord is unavailable — catalog can't be read right now\.$/
    );
    expectPresentationSafe(view, { forbidden: FORBIDDEN });
  });
});
