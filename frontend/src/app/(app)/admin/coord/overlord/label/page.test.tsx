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

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
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
  search = "";
});

describe("OverlordLabelPage", () => {
  it("prefills the intervention id from ?intervention_id=", async () => {
    search = `intervention_id=${IID}`;
    render(<OverlordLabelPage />);
    expect(await screen.findByLabelText("Intervention id")).toHaveValue(IID);
    expect(
      screen.getByText("Submit label").closest("button")
    ).not.toBeDisabled();
  });

  it("starts empty without the query parameter", async () => {
    render(<OverlordLabelPage />);
    expect(await screen.findByLabelText("Intervention id")).toHaveValue("");
    expect(screen.getByText("Submit label").closest("button")).toBeDisabled();
  });

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

  it("shows coord's refusal of web's credential, not a bare code", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            error: "coord_upstream_error",
            message:
              "coord refused web's service credential (coord answered 403 token_carries_no_tenant); your own session is fine",
            coord_status: 403,
            coord_detail: { error: "token_carries_no_tenant" },
          },
        }),
        { status: 502 }
      )
    );
    render(<OverlordLabelPage />);
    fill();
    fireEvent.click(screen.getByText("Submit label"));

    const alert = await screen.findByTestId("overlord-label-error");
    expect(alert.textContent).toContain("token_carries_no_tenant");
    expect(alert.textContent).toContain("your own session is fine");
  });

  it("shows the same sentence from the production-flattened envelope", async () => {
    // http_exception_handler spreads a dict detail to the top level.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "coord_upstream_error",
          message:
            "coord refused web's service credential (coord answered 401 unauthorized); your own session is fine",
          coord_status: 401,
          coord_detail: { error: "unauthorized" },
          path: "/api/v1/admin/coord/overlord/labels",
        }),
        { status: 502 }
      )
    );
    render(<OverlordLabelPage />);
    fill();
    fireEvent.click(screen.getByText("Submit label"));

    const alert = await screen.findByTestId("overlord-label-error");
    expect(alert.textContent).toContain("coord answered 401 unauthorized");
    expect(alert.textContent).toContain("your own session is fine");
  });
});
