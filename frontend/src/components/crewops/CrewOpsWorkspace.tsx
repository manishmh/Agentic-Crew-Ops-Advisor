import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Clock3, Command, FileCheck2, GitBranch, History, MessageSquare, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { operation } from "../../data/mocks";
import { liveScenarios, product } from "../../data/project";
import type { AssistantMessage, RecoveryOption, Scenario } from "../../types/operations";
import { Badge } from "../ui";
import { ScenarioResult } from "./ScenarioResult";

type Props = {
  messages: AssistantMessage[];
  activeId?: number;
  setActiveId: (id: number | undefined) => void;
  onEvidence: (option: RecoveryOption, scenario: Scenario) => void;
  onNetwork: () => void;
  onRunQuery: (question: string) => Promise<boolean>;
  onNewBlank: () => void;
  submitting: boolean;
  focusToken: number;
};

export function CrewOpsWorkspace({ messages, activeId, setActiveId, onEvidence, onNetwork, onRunQuery, onNewBlank, submitting, focusToken }: Props) {
  const [query, setQuery] = useState("");
  const [newAnalysisOpen, setNewAnalysisOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = activeId === 0 ? undefined : messages.find(item => item.id === activeId) ?? messages.at(-1);

  useEffect(() => { input.current?.focus(); }, [focusToken]);

  const executeQuery = async (text: string) => {
    const normalized = text.trim();
    if (!normalized || submitting) return;
    setNewAnalysisOpen(false);
    setQuery(normalized);
    scroll.current?.scrollTo({ top: 0 });
    const succeeded = await onRunQuery(normalized);
    if (succeeded) setQuery("");
  };
  const executeScenario = (scenario: (typeof liveScenarios)[number]) => {
    setActiveId(0);
    void executeQuery(scenario.query);
  };
  const blankAnalysis = () => {
    setNewAnalysisOpen(false);
    setQuery("");
    onNewBlank();
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <div className="crewops-layout" aria-busy={submitting}>
      <aside className="copilot-sidebar">
        <div className="copilot-brand"><div className="ai-icon"><Sparkles size={19} /></div><div><strong>{product.name}</strong><span>Operational intelligence</span></div></div>
        <div className="new-analysis-wrap">
          <button className="button new-analysis" aria-expanded={newAnalysisOpen} onClick={() => setNewAnalysisOpen(open => !open)} data-testid="new-analysis">
            <Plus size={15} /> New analysis<span>⌘ K</span>
          </button>
          {newAnalysisOpen && <div className="new-analysis-menu" role="menu">
            <button role="menuitem" onClick={blankAnalysis} data-testid="new-analysis-blank"><Plus size={13} /><span><strong>Blank analysis</strong><small>Start with an empty command</small></span></button>
            {liveScenarios.map(scenario => <button role="menuitem" key={scenario.id} onClick={() => executeScenario(scenario)} data-testid={`new-analysis-${scenario.id}`} disabled={submitting}><span className="scenario-number">{scenario.label}</span><small>{scenario.query}</small></button>)}
          </div>}
        </div>
        <div className="sidebar-section-title"><History size={13} /> THIS SESSION <span>{messages.length.toString().padStart(2, "0")}</span></div>
        <div className="analysis-history">
          {messages.length === 0 ? <p className="muted sidebar-empty">Your analyses will appear here.</p> : [...messages].reverse().map(item => <button className={active?.id === item.id ? "active" : ""} key={item.id} onClick={() => { setActiveId(item.id); scroll.current?.scrollTo({ top: 0 }); }}><MessageSquare size={14} /><span>{item.query}</span><ChevronRight size={12} /></button>)}
        </div>
        <div className="sidebar-section-title"><FileCheck2 size={13} /> TRY A LIVE SCENARIO</div>
        <div className="scenario-nav">
          {liveScenarios.map((scenario, index) => <button key={scenario.id} onClick={() => executeScenario(scenario)} disabled={submitting} data-testid={`sidebar-scenario-${scenario.id}`}><span className="scenario-number">0{index + 1}</span><span>{scenario.label}</span><ArrowUp size={12} /></button>)}
        </div>
        <div className="sidebar-trust"><ShieldCheck size={20} /><strong>Every decision. Explained.</strong><p>Traceable legality, exact costs and transparent recovery options.</p><div><span className="live-dot" /> Synthetic operational data</div></div>
      </aside>
      <main className="copilot-main">
        <header className="copilot-header"><div><div className="eyebrow"><span className="live-dot" /> LIVE OPERATIONS WORKSPACE</div><h1>Crew recovery desk</h1><p>Deterministic disruption analysis and recovery planning</p></div><button className="text-link" onClick={onNetwork}><GitBranch size={14} /> Network view <ChevronRight size={14} /></button></header>
        <div className="context-strip"><span><strong>{operation.flights}</strong> flights</span><span><strong>{operation.crew}</strong> crew</span><span><strong>{operation.reserves}</strong> reserves</span><span className="hub-marker">BLR hub</span><span className="snapshot-label">SYNTHETIC SNAPSHOT · 14 SEP 2026</span></div>
        <nav className="quick-scenarios" aria-label="Quick live scenarios">{liveScenarios.map(scenario => <button key={scenario.id} onClick={() => executeScenario(scenario)} disabled={submitting}>{scenario.label}</button>)}</nav>
        <div className="mobile-analysis-action">
          <button className="button" onClick={() => setNewAnalysisOpen(open => !open)} aria-expanded={newAnalysisOpen}><Plus size={13} /> New analysis</button>
          {newAnalysisOpen && <div className="new-analysis-menu" role="menu"><button role="menuitem" onClick={blankAnalysis}><Plus size={13} /><span><strong>Blank analysis</strong><small>Start with an empty command</small></span></button>{liveScenarios.map(scenario => <button role="menuitem" key={scenario.id} onClick={() => executeScenario(scenario)} disabled={submitting}><span className="scenario-number">{scenario.label}</span><small>{scenario.query}</small></button>)}</div>}
        </div>
        <div className="conversation-scroll" ref={scroll}>
          {!active ? <div className="empty-copilot">
            <div className="empty-emblem"><Sparkles size={30} /><span /></div><div className="eyebrow">TRY A LIVE SCENARIO</div><h2>Start with a crew disruption.</h2><p>Choose a scenario below to run the operational analysis API, or enter a question.</p>
            <div className="prompt-grid">{liveScenarios.map((scenario, index) => <button key={scenario.id} onClick={() => executeScenario(scenario)} disabled={submitting} data-testid={`workspace-scenario-${scenario.id}`}><span className={`prompt-icon prompt-${index}`}>{index === 1 ? <Clock3 size={16} /> : index === 2 ? <ShieldCheck size={16} /> : index === 3 ? <GitBranch size={16} /> : <MessageSquare size={16} />}</span><span><strong className="scenario-label">{scenario.label}</strong>{scenario.query}</span><ArrowUp size={14} /></button>)}</div>
            <div className="empty-footnote"><ShieldCheck size={13} /> Deterministic rules. Transparent reasoning. Operator in control.</div>
          </div> : <div className="conversation">
            <div className="operator-query"><div className="small-avatar">AK</div><div><span className="eyebrow">YOU <span>· OPERATIONS CONTROLLER</span></span><p>{active.query}</p></div></div>
            <div className="assistant-heading"><div className="ai-icon"><Sparkles size={16} /></div><strong>{product.name}</strong><Badge tone="blue">ANALYSIS</Badge><span className="muted">{active.scenario?.live ? "Live deterministic result" : active.state === "loading" ? "Analysis in progress" : "Operational response"}</span></div>
            {active.state === "loading" ? <div className="api-state" role="status"><span className="api-spinner" /><div><strong>Analyzing operational impact</strong><p>Resolving pairings, deterministic legality and ranked recovery options.</p></div></div>
            : active.state === "error" ? <div className="api-state error" role="alert"><div><strong>{active.errorTitle ?? "Analysis unavailable"}</strong><p>{active.error}</p><small>Adjust the request or choose a guided scenario. The workspace remains ready.</small></div></div>
            : active.state === "empty" ? <div className="api-state"><div><strong>{active.errorTitle ?? "No affected duties returned"}</strong><p>{active.error ?? "The deterministic service completed without an operational result for this request."}</p></div></div>
            : active.scenario ? <ScenarioResult scenario={active.scenario} onEvidence={onEvidence} />
            : <div className="generic-response"><h2>Choose an operational scenario.</h2><p>The five supported analyses run through the backend CrewOps engine.</p><div className="prompt-grid">{liveScenarios.map(scenario => <button key={scenario.id} onClick={() => executeScenario(scenario)} disabled={submitting}><span><strong className="scenario-label">{scenario.label}</strong>{scenario.query}</span><ArrowRight size={14} /></button>)}</div></div>}
            <button className="another-analysis" onClick={() => { input.current?.focus(); scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }}>Run another analysis <ArrowDown size={13} /></button>
          </div>}
        </div>
        <div className="command-area">
          <form className="command-input" onSubmit={event => { event.preventDefault(); void executeQuery(query); }}><Command size={18} /><textarea ref={input} rows={1} maxLength={2000} aria-label="CrewOps command" placeholder="Ask about crew, flights, delays, closures…" value={query} disabled={submitting} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void executeQuery(query); } }} /><button className="send-button" type="submit" aria-label="Send query" disabled={submitting || !query.trim()}><ArrowUp size={18} /></button></form>
          <div className="command-help"><span><ShieldCheck size={11} /> Synthetic data · independent scenarios</span><span>Enter to send <span className="keycap">↵</span> <i /> Shift + Enter for a new line</span></div>
        </div>
      </main>
    </div>
  );
}
