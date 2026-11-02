/**
 * OutputViewer: an access rule reads as its sentence; any other failure keeps
 * its status and the runner's body.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const fetchMock = vi.fn();

vi.mock("@/lib/api/operations/coordFleet", () => ({
  fetchRunnerTaskOutput: (...args: unknown[]) => fetchMock(...args),
}));

import { OutputViewer } from "./OutputViewer";

const SENTENCE =
  "this runner's beacon names this server's own address, and tasks at that address are limited to platform administrators";
const rejection = (status: number, body: string) =>
  new Error(`GET /x failed: ${status} - ${body}`);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("OutputViewer", () => {
  it("shows the co-located beacon refusal as its sentence", async () => {
    fetchMock.mockRejectedValue(
      rejection(
        403,
        JSON.stringify({
          message: SENTENCE,
          refusal: { discriminator: "co_located_beacon_admin_only" },
        })
      )
    );

    render(<OutputViewer runnerId="r" taskRunId="t" />);

    expect(await screen.findByText(SENTENCE)).toBeTruthy();
  });

  it("keeps another 403's status and body", async () => {
    fetchMock.mockRejectedValue(rejection(403, '{"message":"Forbidden"}'));

    render(<OutputViewer runnerId="r" taskRunId="t" />);

    expect(
      await screen.findByText(
        'Failed to fetch output: 403 - {"message":"Forbidden"}'
      )
    ).toBeTruthy();
  });
});
