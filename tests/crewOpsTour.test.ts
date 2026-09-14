// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Config, Driver } from "driver.js";
import { buildAvailableTourSteps, startCrewOpsTour } from "../frontend/src/onboarding/crewOpsTour.js";
import { CREWOPS_ONBOARDING_KEY } from "../frontend/src/onboarding/onboardingStorage.js";

function driverMock() {
  let config: Config | undefined;
  const drive = vi.fn();
  const destroy = vi.fn();
  const create = vi.fn((nextConfig?: Config) => {
    config = nextConfig;
    return { drive, destroy, isLastStep: () => false } as unknown as Driver;
  });
  return { create, drive, destroy, getConfig: () => config };
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 100, height: 20 }],
  });
});

describe("CrewOps dynamic tour", () => {
  test("omits unavailable result and evidence targets without crashing", () => {
    document.body.innerHTML = `
      <div data-tour="workspace"></div>
      <div data-tour="query-input"><textarea></textarea></div>
      <div data-tour="live-scenarios"></div>
      <div data-tour="agent-principle"></div>
      <div data-tour="session-history"></div>
    `;
    const mocked = driverMock();
    expect(buildAvailableTourSteps()).toHaveLength(5);
    expect(() => startCrewOpsTour(mocked.create)).not.toThrow();
    expect(mocked.getConfig()?.steps).toHaveLength(5);
    expect(mocked.drive).toHaveBeenCalledOnce();
  });

  test("includes result and decision evidence only when mounted", () => {
    document.body.innerHTML = `
      <div data-tour="workspace"></div><div data-tour="query-input"></div>
      <div data-tour="live-scenarios"></div><div data-tour="agent-principle"></div>
      <div data-tour="session-history"></div><div data-tour="result"></div>
      <button data-tour="decision-evidence"></button>
    `;
    expect(buildAvailableTourSteps()).toHaveLength(7);
  });

  test("completion records completed and focuses the query input", () => {
    document.body.innerHTML = '<div data-tour="workspace"></div><div data-tour="query-input"><textarea></textarea></div>';
    const mocked = driverMock();
    expect(startCrewOpsTour(mocked.create)).toBe(true);
    mocked.getConfig()?.onDoneClick?.(undefined, {}, {} as never);
    expect(window.localStorage.getItem(CREWOPS_ONBOARDING_KEY)).toBe("completed");
    expect(document.activeElement).toBe(document.querySelector("textarea"));
    expect(mocked.destroy).toHaveBeenCalledOnce();
  });
});
