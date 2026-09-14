export const CREWOPS_ONBOARDING_KEY = "crewops:onboarding:v1";

export type OnboardingState = "completed" | "skipped";

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function getOnboardingState(): OnboardingState | undefined {
  try {
    const value = browserStorage()?.getItem(CREWOPS_ONBOARDING_KEY);
    return value === "completed" || value === "skipped" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function shouldShowOnboardingWelcome(): boolean {
  return getOnboardingState() === undefined;
}

export function setOnboardingState(state: OnboardingState): void {
  try {
    browserStorage()?.setItem(CREWOPS_ONBOARDING_KEY, state);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function markOnboardingCompleted(): void {
  setOnboardingState("completed");
}

export function markOnboardingSkipped(): void {
  setOnboardingState("skipped");
}
