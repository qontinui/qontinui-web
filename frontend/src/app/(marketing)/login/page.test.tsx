import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  next: null as string | null,
  user: null as { id: string } | null,
  replace: vi.fn(),
  startCognitoLogin: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () =>
    new URLSearchParams(
      state.next === null ? "" : `next=${encodeURIComponent(state.next)}`
    ),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock("@/services/auth/cognito-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/auth/cognito-oauth")>()),
  startCognitoLogin: state.startCognitoLogin,
}));

import LoginPage from "./page";

// The post-login destination is attacker-influenced (anyone can send a
// /login?next= link), so it is honoured only when it stays on this origin.
const OFF_ORIGIN = [
  "//elsewhere.example/x",
  "/\\elsewhere.example",
  "https://elsewhere.example/x",
  "/.//elsewhere.example",
  "/%2e//elsewhere.example",
];

beforeEach(() => {
  state.next = null;
  state.user = null;
  state.replace.mockClear();
  state.startCognitoLogin.mockClear();
});

describe("/login — an already signed-in visitor", () => {
  it("goes to a same-origin next", () => {
    state.user = { id: "u" };
    state.next = "/co-pilot?tab=runs";
    render(<LoginPage />);
    expect(state.replace).toHaveBeenCalledWith("/co-pilot?tab=runs");
  });

  it.each(OFF_ORIGIN)(
    "goes home instead of an off-origin next (%s)",
    (next) => {
      state.user = { id: "u" };
      state.next = next;
      render(<LoginPage />);
      expect(state.replace).toHaveBeenCalledWith("/admin/coord");
    }
  );
});

describe("/login — signing in", () => {
  it("carries a same-origin next into the sign-in", () => {
    state.next = "/co-pilot";
    render(<LoginPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ })
    );
    expect(state.startCognitoLogin).toHaveBeenCalledWith("Google", "/co-pilot");
  });

  it.each(OFF_ORIGIN)("drops an off-origin next (%s)", (next) => {
    state.next = next;
    render(<LoginPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ })
    );
    expect(state.startCognitoLogin).toHaveBeenCalledWith("Google", undefined);
  });
});
