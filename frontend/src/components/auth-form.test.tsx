import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCognitoLogin = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/services/auth/cognito-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/auth/cognito-oauth")>()),
  startCognitoLogin,
}));

import { AuthForm } from "./auth-form";

beforeEach(() => {
  startCognitoLogin.mockClear();
});

// AuthForm is mounted by the /login page AND the marketing header's dialog,
// so it validates `next` itself rather than trusting its caller.
describe("AuthForm — the post-login destination", () => {
  it("carries a same-origin next", () => {
    render(<AuthForm next="/co-pilot" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ })
    );
    expect(startCognitoLogin).toHaveBeenCalledWith("Google", "/co-pilot");
  });

  it.each([
    "//elsewhere.example/x",
    "/\\elsewhere.example",
    "https://elsewhere.example/x",
    "/.//elsewhere.example",
    "/%2e//elsewhere.example",
  ])("drops an off-origin next (%s)", (next) => {
    render(<AuthForm next={next} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ })
    );
    expect(startCognitoLogin).toHaveBeenCalledWith("Google", undefined);
  });
});
