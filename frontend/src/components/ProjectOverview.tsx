import { ArrowRight, GitBranch, Plane, ShieldCheck } from 'lucide-react';
import { product, facts, verification } from '../data/project';
import { Modal } from './ui';

export function ProjectOverview({ onOpen, onArchitecture }: { onOpen: () => void; onArchitecture: () => void }) {
  return <main className="project-overview">
    <header className="project-masthead"><Plane size={23} /><strong>{product.name}</strong><span>SYNTHETIC OPERATIONS / BLR</span></header>
    <div className="project-intro-grid">
      <section className="project-intro">
        <p className="eyebrow">ENGINEERING CASE STUDY · AIRLINE CREW CONTROL</p>
        <h1>When the roster breaks,<br />find a legal way forward.</h1>
        <p className="project-description">{product.description}</p>
        <div className="project-actions"><button className="button primary" onClick={onOpen}>Open Operations Workspace <ArrowRight size={16} /></button><button className="button" onClick={onArchitecture}>View Architecture <GitBranch size={16} /></button></div>
        <p className="project-disclaimer">{product.disclaimer}</p>
      </section>
      <aside className="project-decision"><span className="eyebrow">THE DESIGN DECISION</span><ShieldCheck size={28} /><h2>{product.principle}</h2><p>Trace each recommendation through affected duties, hard rule checks, rejected candidates, and exact costs.</p><div className="project-route">Interpret <span>→</span> Validate <span>→</span> Recover <span>→</span> Explain</div></aside>
    </div>
    <section className="project-metrics" aria-label="Synthetic dataset scale">{[[facts.flights, 'Flights'], [facts.crew, 'Crew'], [facts.pairings, 'Pairings'], [facts.reserves, 'Reserves'], [verification.testsPassed, 'Automated tests'], [5, 'Live disruption types']].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</section>
    <section className="project-engineering"><div><p className="eyebrow">SYSTEM RELIABILITY</p><h2>Evidence you can inspect.</h2><p>Dataset-wide tests exercise rolling limits, disruption simulation and shared recovery candidates. The agent is measured separately from the deterministic engine.</p></div><div><strong>{facts.offlineCases} scripted evaluation cases</strong><p>Offline schema and harness checks. They do not measure real model interpretation.</p><strong>{verification.historicalLiveCorrect} / {verification.historicalLiveCases} live planner cases correct</strong><p>Historical final stability sample: five runs, zero provider failures, ~1 second planner median. A sample, not a production guarantee.</p><button className="text-link" onClick={onArchitecture}>Explore verification and limitations <ArrowRight size={14} /></button></div></section>
  </main>;
}

export function Architecture({ onClose }: { onClose: () => void }) {
  return <Modal title="Architecture & engineering" subtitle={product.name} onClose={onClose}>
    <div className="architecture-body"><p className="architecture-principle">{product.principle}</p>
      <div className="architecture-flow" aria-label="Request and fallback flow">
        <div>Natural-language request <small>React → same-origin Node API</small></div><span>↓</span>
        <div className="architecture-branches"><div>Optional LLM planner<small>Intent · entities · clarification</small><span>↓</span>Strict schema + entity validation<span>↓</span>Deterministic controller</div><div>Provider unavailable / invalid<small>Deterministic parser fallback</small><span>↓</span>Canonical query parsing</div></div><span>↓</span>
        <div className="architecture-engine"><strong>CrewOps deterministic engine</strong><p>Operational graph · rules · simulation · recovery · cost & ranking</p><small>FDP, rest, duty and flight-hour windows, certification, qualifications, reserve eligibility, affected operations, candidates and joint allocation</small></div><span>↓</span>
        <div>Grounded explanation / deterministic summary<small>Grounding guard → evidence-backed UI</small></div>
      </div>
      <section><h3>Deterministic verification</h3><p>{facts.crew} crew · {facts.flights} flights · {facts.pairings} pairings · {facts.stations} stations · {facts.reserves} reserves · {facts.certifications} certification records.</p><p>{verification.testsPassed} automated tests passed on {verification.verifiedOn}. The dataset sweep exercises {verification.datasetSweepAnalyses.toLocaleString()} analyses; the broader verification suite exceeds 2,700 analysis calls. Checks include boundary dates, graph immutability, exact cost components and no duplicate joint assignments.</p></section>
      <section><h3>Agent evaluation</h3><p>{facts.offlineCases} offline scripted cases validate the schema and evaluation harness. The historical five-run live stability sample scored 35/35 across intent, entities, clarification and unsupported recognition, with no provider failures. Live behavior remains stochastic.</p></section>
      <section><h3>Scope & limitations</h3><p>Independent synthetic project, not connected to a live airline and not intended for operational aviation use. Certification checks assess supplied records; they do not prove completeness. Aircraft swaps, rerouting, prediction and passenger optimization are unsupported. Scenarios are independent simulations.</p></section>
    </div>
  </Modal>;
}
