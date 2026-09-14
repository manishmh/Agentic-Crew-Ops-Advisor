import { driver } from "driver.js";
import type { DriveStep } from "driver.js";
import { markOnboardingCompleted, markOnboardingSkipped } from "./onboardingStorage";

type TourDefinition = {
  selectors: string[];
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
};

const tourDefinitions: TourDefinition[] = [
  {
    selectors: ['[data-tour="workspace"]'],
    title: "Crew recovery workspace",
    description: "This is an airline Crew Operations recovery workspace. It analyzes disruptions such as sick crew, flight delays, station closures, certification expiry, and simultaneous crew events.",
    side: "bottom",
  },
  {
    selectors: ['[data-tour="query-input"]'],
    title: "Ask an operational question",
    description: "Enter a natural-language disruption or choose one of the live scenarios. The request is converted into a validated operational analysis.",
    side: "top",
  },
  {
    selectors: ['[data-tour="live-scenarios"]', '[data-tour="live-scenarios-mobile"]'],
    title: "Run a live scenario",
    description: "Use these scenarios to test sick crew recovery, delay propagation, station closure, certification risk, and joint recovery against the live deterministic engine.",
    side: "right",
  },
  {
    selectors: ['[data-tour="agent-principle"]'],
    title: "AI interprets. Code decides.",
    description: "The LLM handles intent planning and explanation. Crew legality, timing, qualification, cost, recovery generation, and ranking are calculated by deterministic code.",
    side: "bottom",
  },
  {
    selectors: ['[data-tour="session-history"]'],
    title: "Compare previous analyses",
    description: "Analyses from this browser session appear here so you can revisit previous recovery decisions without rerunning them.",
    side: "right",
  },
  {
    selectors: ['[data-tour="result"]'],
    title: "Evidence-backed recovery",
    description: "Each analysis shows the operational impact, legality consequence, recommended recovery, exact modeled cost, delay, alternatives, and rejected candidates.",
    side: "left",
  },
  {
    selectors: ['[data-tour="decision-evidence"]'],
    title: "Inspect the decision",
    description: "Decision Evidence exposes the deterministic rule trace behind the recommendation, while Architecture and Network View explain the system and operational model.",
    side: "left",
  },
];

function visibleTarget(selectors: string[], root: ParentNode): Element | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (!element) continue;
    if (typeof element.getClientRects !== "function" || element.getClientRects().length > 0) return element;
  }
  return undefined;
}

export function buildAvailableTourSteps(root?: ParentNode): DriveStep[] {
  const searchRoot = root ?? (typeof document === "undefined" ? undefined : document);
  if (!searchRoot) return [];
  return tourDefinitions.flatMap(({ selectors, title, description, side }) => {
    const element = visibleTarget(selectors, searchRoot);
    return element ? [{ element, popover: { title, description, side, align: "start" as const } }] : [];
  });
}

export function focusCrewOpsQuery(): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>('[data-tour="query-input"] textarea')?.focus();
  });
}

export function startCrewOpsTour(createTour: typeof driver = driver): boolean {
  if (typeof document === "undefined") return false;
  const steps = buildAvailableTourSteps();
  if (steps.length === 0) return false;

  const returnFocus = document.activeElement as HTMLElement | null;
  let finished = false;
  let skipped = false;
  const tour = createTour({
    steps,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    allowKeyboardControl: true,
    overlayClickBehavior: "close",
    stagePadding: 7,
    stageRadius: 5,
    popoverOffset: 10,
    popoverClass: "crewops-tour-popover",
    showButtons: ["previous", "next", "close"],
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Start exploring",
    skipMissingElement: true,
    onPopoverRender: (popover) => {
      popover.closeButton.textContent = "Skip";
      popover.closeButton.setAttribute("aria-label", "Skip tour");
      popover.previousButton.setAttribute("aria-label", "Previous tour step");
      popover.nextButton.setAttribute("aria-label", tour.isLastStep() ? "Complete tour and start exploring" : "Next tour step");
    },
    onDoneClick: () => {
      finished = true;
      markOnboardingCompleted();
      tour.destroy();
      focusCrewOpsQuery();
    },
    onCloseClick: () => {
      skipped = true;
      markOnboardingSkipped();
      tour.destroy();
    },
    onDestroyed: () => {
      if (!finished && !skipped) markOnboardingSkipped();
      if (!finished) requestAnimationFrame(() => returnFocus?.isConnected && returnFocus.focus());
    },
  });
  tour.drive();
  return true;
}
