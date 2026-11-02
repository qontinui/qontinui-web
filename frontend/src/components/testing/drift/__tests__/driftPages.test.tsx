/**
 * The drift pages hand their components the ids as the runner knows them.
 * `useParams` returns a segment still percent-encoded, and the drift client
 * encodes it again, so without the decode `state:a` would be asked for as
 * `state%3Aa` and a listed entry would read as not found.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const params = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock("next/navigation", () => ({ useParams: () => params.current }));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => (
    <div data-testid="rendered">{JSON.stringify(props)}</div>
  ),
}));

import DriftListPage from "@/app/(app)/runs/[id]/drift/page";
import DriftEntryPage from "@/app/(app)/runs/[id]/drift/[entryId]/page";

const rendered = () =>
  JSON.parse(screen.getByTestId("rendered").textContent ?? "{}");

afterEach(cleanup);

describe("drift pages", () => {
  it("decodes the run id for the report page", () => {
    params.current = { id: "run%3A1" };

    render(<DriftListPage />);

    expect(rendered()).toEqual({ runId: "run:1" });
  });

  it("decodes both ids for the entry page", () => {
    params.current = { id: "run%3A1", entryId: "state%3Aa" };

    render(<DriftEntryPage />);

    expect(rendered()).toEqual({ runId: "run:1", entryId: "state:a" });
  });
});
