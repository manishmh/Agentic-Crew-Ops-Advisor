// @vitest-environment jsdom

import React from "../frontend/node_modules/react/index.js";
import { cleanup, render, screen, waitFor } from "../frontend/node_modules/@testing-library/react/dist/index.js";
import userEvent from "../frontend/node_modules/@testing-library/user-event/dist/esm/index.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const startCrewOpsTour = vi.hoisted(() => vi.fn(() => true));

vi.mock("../frontend/src/onboarding/crewOpsTour", () => ({ startCrewOpsTour }));

import { AppShell } from "../frontend/src/app/AppShell.js";
import { CREWOPS_ONBOARDING_KEY } from "../frontend/src/onboarding/onboardingStorage.js";

function enterCrewOpsWorkspace() {
  render(<AppShell />);
  return userEvent.click(screen.getByRole("button", { name: /open operations workspace/i }));
}

beforeEach(() => {
  window.localStorage.clear();
  startCrewOpsTour.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 100, height: 20 }],
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.removeAttribute("open"); },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CrewOps first-visit onboarding", () => {
  test("shows the welcome card on the first meaningful workspace visit", async () => {
    await enterCrewOpsWorkspace();
    expect(await screen.findByRole("dialog", { name: "CrewOps Recovery Copilot" })).toBeTruthy();
    expect(window.localStorage.getItem(CREWOPS_ONBOARDING_KEY)).toBeNull();
  });

  test("Explore myself closes the welcome and records skipped", async () => {
    await enterCrewOpsWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Explore myself" }));
    expect(screen.queryByRole("dialog", { name: "CrewOps Recovery Copilot" })).toBeNull();
    expect(window.localStorage.getItem(CREWOPS_ONBOARDING_KEY)).toBe("skipped");
  });

  test("Take 60-second tour closes the welcome and starts Driver.js", async () => {
    await enterCrewOpsWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Take 60-second tour" }));
    expect(startCrewOpsTour).toHaveBeenCalledOnce();
  });

  test("does not auto-show the welcome for a completed visitor", async () => {
    window.localStorage.setItem(CREWOPS_ONBOARDING_KEY, "completed");
    await enterCrewOpsWorkspace();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "CrewOps Recovery Copilot" })).toBeNull());
  });

  test("How this works manually starts the tour even after completion", async () => {
    window.localStorage.setItem(CREWOPS_ONBOARDING_KEY, "completed");
    await enterCrewOpsWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "How this works" }));
    expect(startCrewOpsTour).toHaveBeenCalledOnce();
  });
});
