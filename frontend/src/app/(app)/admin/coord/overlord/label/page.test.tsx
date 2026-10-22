/**
 * /admin/coord/overlord/label — the bare form posts the label body and shows
 * the row or coord's typed refusal as sent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import OverlordLabelPage from "./page";

const IID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function fill() {
  fireEvent.change(screen.getByLabelText("Intervention id"), {
    target: { value: IID },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OverlordLabelPage", () => {
  it("posts the class label and shows the returned row", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "row-1", operator_label: "B" }), {
        status: 200,
      })
    );
    render(<OverlordLabelPage />);
    fill();
    fireEvent.change(screen.getByLabelText("Class"), {
      target: { value: "B" },
    });
    fireEvent.click(screen.getByText("Submit label"));

    await waitFor(() => screen.getByTestId("overlord-label-result"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/admin/coord/overlord/labels");
    expect(JSON.parse(init.body)).toEqual({
      intervention_id: IID,
      label_kind: "class",
      operator_label: "B",
    });
    expect(screen.getByTestId("overlord-label-result").textContent).toContain(
      "row-1"
    );
  });

  it("offers no E for a false finish and sends no class if none chosen", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<OverlordLabelPage />);
    fill();
    fireEvent.click(screen.getByLabelText("false_finish"));
    const options = Array.from(
      screen.getByLabelText("Class").querySelectorAll("option")
    ).map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain("E");
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Submit label"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      intervention_id: IID,
      label_kind: "false_finish",
    });
  });

  it("shows a typed refusal with its status", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error: "intervention_not_found" } }),
        { status: 404 }
      )
    );
    render(<OverlordLabelPage />);
    fill();
    fireEvent.click(screen.getByText("Submit label"));

    const alert = await screen.findByTestId("overlord-label-error");
    expect(alert.textContent).toContain("intervention_not_found");
  });
});
