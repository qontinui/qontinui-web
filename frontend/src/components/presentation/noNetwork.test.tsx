/**
 * D3.4 of plan `2026-10-23-console-presentation-spaces`: "nothing new is
 * fetched for presentation mode". The lens and every primitive in this folder
 * render from what the page already holds — so mounting them, presenting,
 * toggling and re-rendering issue no request of any kind, with ONE exception:
 * the tenant's redaction scope, `GET /api/v1/presentation/scope`, read once
 * while presenting by `presentationScopeLoader.ts`.
 *
 * Two layers, each able to fail on its own:
 *
 * 1. **Behaviour** — every request a lens page makes is recorded (fetch, XHR,
 *    sockets, event sources). Presenting reads the scope exactly once, and
 *    the scope it reads reaches `RedactedText`; operator mode reads nothing.
 * 2. **Source** — no module in this folder but the loader carries network
 *    code, directly or through an API-client import, and the scan sees the
 *    loader (so its allow-list entry is not dead).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationScopeRecord } from "@/lib/api/presentationScope";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import {
  Caption,
  CostFigure,
  MachineName,
  OperatorOnly,
  PresentationLens,
  PresentationModeToggle,
  Provenance,
  RedactedText,
  defaultPresentationModeStore,
  defaultPresentationScopeStore,
} from "./index";

const SCOPE_URL = "/api/v1/presentation/scope";

const RECORD: PresentationScopeRecord = {
  tenant_id: "00000000-0000-0000-0000-00000000000a",
  first_party_owners: ["qontinui"],
  first_party_owners_source: "configured",
  first_party_owners_unknown_reason: null,
  confidential_terms: ["Acme Corp"],
  configured: {
    first_party_owners: ["qontinui"],
    confidential_terms: [],
    version: 1,
    updated_at: "2026-10-23T12:00:00Z",
    updated_by: null,
  },
  defaults: {
    registered_repo_owners: ["qontinui"],
    registered_repo_owners_unknown_reason: null,
    viewer_other_tenant_names: ["Acme Corp"],
  },
  can_edit: false,
};

const requests: string[] = [];
const realWebSocket = globalThis.WebSocket;
const realEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class RecordingSocket {
  constructor(url: string | URL) {
    requests.push(`websocket ${String(url)}`);
  }
}

function resetLens(search: string) {
  window.sessionStorage.clear();
  window.localStorage.clear();
  defaultPresentationModeStore.recordChoice(false, { remember: false });
  defaultPresentationScopeStore.invalidate();
  window.history.replaceState(null, "", `/admin/coord/devops${search}`);
}

beforeEach(() => {
  requests.length = 0;
  resetLens("?present=1");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(`fetch ${init?.method ?? "GET"} ${url}`);
    if (url === SCOPE_URL) {
      return new Response(JSON.stringify(RECORD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 599 });
  });
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL
  ) {
    requests.push(`xhr ${method} ${String(url)}`);
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: RecordingSocket,
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: RecordingSocket,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: realWebSocket,
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: realEventSource,
  });
  resetLens("");
  window.history.replaceState(null, "", "/");
});

function LensPage() {
  return (
    <PresentationLens>
      <PresentationModeToggle />
      <Caption id="dev-ops.page" />
      <Provenance source="coord fleet health" asOf="2026-10-23T12:00:00Z" />
      <RedactedText
        text="Ship the lens"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan", status: "draft" }}
        data-testid="first-party-title"
      />
      <MachineName identity={{ hostname: "build-host-1" }} />
      <CostFigure amount={1.25} source="reported" />
      <OperatorOnly>
        <button type="button">Drain this machine</button>
      </OperatorOnly>
    </PresentationLens>
  );
}

/** Let effects, the mocked read and its microtasks settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("presentation mode reads the scope and nothing else (D3.4)", () => {
  it("reads the scope once through toggles and re-renders, and it reaches the page", async () => {
    const { rerender } = render(<LensPage />);
    // Fail closed until the scope is read: the title is withheld…
    expect(screen.getByTestId("first-party-title")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    // …and the one read lets the first-party title through.
    await waitFor(() =>
      expect(screen.getByTestId("first-party-title")).toHaveAttribute(
        "data-redacted",
        "false"
      )
    );
    expect(screen.getByTestId("first-party-title")).toHaveTextContent(
      "Ship the lens"
    );

    const toggle = () =>
      act(() => {
        fireEvent.click(
          screen.getByRole("button", { name: "Presentation mode" })
        );
      });
    toggle();
    toggle();
    rerender(<LensPage />);
    await settle();
    expect(requests).toEqual([`fetch GET ${SCOPE_URL}`]);
  });

  it("reads nothing at all in operator mode", async () => {
    resetLens("?present=0");
    const { rerender } = render(<LensPage />);
    rerender(<LensPage />);
    await settle();
    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(requests).toEqual([]);
  });

  it("a failed read withholds every title rather than revealing it", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      requests.push(`fetch ${init?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify({ error: "down" }), { status: 403 });
    });
    render(<LensPage />);
    await settle();
    expect(requests).toEqual([`fetch GET ${SCOPE_URL}`]);
    expect(defaultPresentationScopeStore.getSnapshot().state.status).toBe(
      "error"
    );
    expect(screen.getByTestId("first-party-title")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    expect(screen.queryByText("Ship the lens")).not.toBeInTheDocument();
  });
});

/**
 * Modules in this folder allowed to read the network: ONLY the loader of the
 * tenant's presentation scope, the one read D3.4 permits presentation mode,
 * by its path relative to this folder.
 */
const SCOPE_LOADER = "presentationScopeLoader.ts";
const ALLOWED_NETWORK_MODULES: ReadonlySet<string> = new Set<string>([
  SCOPE_LOADER,
]);

/**
 * Network code: a request primitive, a client, a query hook — or a VALUE
 * import (or re-export) of an API-client module, which is network code one
 * module away. A type-only import is not.
 */
const NETWORK =
  /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|new\s+EventSource|sendBeacon|httpClient|service-factory|@tanstack\/react-query|\buseQuery\b|\baxios\b|^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']@\/(?:lib\/api(?:-client)?|services)\//m;

function sourceOf(file: string): string {
  return readFileSync(join(__dirname, file), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    ""
  );
}

describe("the presentation folder carries no network code but the scope loader", () => {
  const all = readdirSync(__dirname, { recursive: true })
    .map((f) => String(f).split("\\").join("/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const files = all.filter((f) => !ALLOWED_NETWORK_MODULES.has(f));

  it("scans the folder (not vacuously)", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.some((f) => f.endsWith("PresentationModeProvider.tsx"))).toBe(
      true
    );
  });

  it("calls no fetch, XHR, socket, http client or query hook", () => {
    expect(files.filter((f) => NETWORK.test(sourceOf(f)))).toEqual([]);
  });

  it("sees the loader's read, so its allow-list entry is not dead", () => {
    expect(all).toContain(SCOPE_LOADER);
    expect(NETWORK.test(sourceOf(SCOPE_LOADER))).toBe(true);
  });

  it("would catch a value import of an API client, and pass a type-only one", () => {
    expect(NETWORK.test(`import { fetchThing } from "@/lib/api/thing";`)).toBe(
      true
    );
    expect(
      NETWORK.test(`import {\n  a,\n  b,\n} from "@/services/thing-service";`)
    ).toBe(true);
    expect(NETWORK.test(`export { a } from "@/lib/api-client/x";`)).toBe(true);
    expect(NETWORK.test(`import type { Thing } from "@/lib/api/thing";`)).toBe(
      false
    );
    expect(NETWORK.test(`import { cn } from "@/lib/utils";`)).toBe(false);
  });
});
