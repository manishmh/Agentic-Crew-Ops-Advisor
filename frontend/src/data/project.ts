import facts from './projectFacts.json' with { type: 'json' };
import verification from './verification.json' with { type: 'json' };

export const product = {
  name: 'CrewOps Recovery Copilot',
  description: 'An agentic airline operations system that analyzes crew disruptions, deterministically validates legality, and recommends evidence-backed recovery plans.',
  principle: 'LLMs interpret and explain. Deterministic code decides legality, timing, cost, and recovery.',
  disclaimer: 'Independent portfolio project built on synthetic airline operations data.',
};
export { facts, verification };
export const liveScenarios = [
  { id: 'sick', label: 'Sick crew', query: 'What happens if C-1042 reports sick?' },
  { id: 'delay', label: 'Delay propagation', query: 'Delay DX412 by 90 minutes' },
  { id: 'closure', label: 'Station closure', query: 'Close HYD from 05:00–09:00 UTC' },
  { id: 'certification', label: 'Certification risk', query: "What happens if C-5417's recurrent training expires?" },
  { id: 'multi', label: 'Joint recovery', query: 'C-3940 and C-1938 report sick on 2026-09-18' },
] as const;
