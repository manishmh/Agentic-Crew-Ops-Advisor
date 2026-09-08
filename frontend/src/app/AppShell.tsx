import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, CalendarDays, ChevronLeft, Clock3, GitBranch, LayoutDashboard, ShieldCheck, Sparkles, X } from "lucide-react";
import { CrewOpsApiError, queryAgent } from "../api/crewops";
import { Architecture, ProjectOverview } from "../components/ProjectOverview";
import { CrewOpsWorkspace } from "../components/crewops/CrewOpsWorkspace";
import { EvidenceDrawer } from "../components/crewops/EvidenceDrawer";
import { Dashboard } from "../components/dashboard/Dashboard";
import { DayBrief } from "../components/daybrief/DayBrief";
import { Network } from "../components/layout/Network";
import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { Timeline } from "../components/timeline/Timeline";
import { Badge, Modal } from "../components/ui";
import { operation } from "../data/mocks";
import { liveScenarios, product } from "../data/project";
import type { AssistantMessage, RecoveryOption, Scenario, ScenarioId, Workspace } from "../types/operations";

const tabs: { name: Workspace; icon: typeof LayoutDashboard }[] = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Timeline", icon: Activity },
  { name: "Day Brief", icon: CalendarDays },
  { name: "CrewOps AI", icon: Sparkles },
];

function errorPresentation(error: unknown) {
  const message = error instanceof Error ? error.message : "CrewOps analysis failed unexpectedly. Please try again.";
  if (!(error instanceof CrewOpsApiError)) return { state: "error" as const, title: "Analysis unavailable", message };
  const titles = { network: "Analysis service unavailable", backend: "Analysis request unsuccessful", malformed: "Unexpected service response", empty: "No affected duties returned", clarification: "Clarification needed", unsupported: "Unsupported request" } as const;
  return { state: error.kind === "empty" ? "empty" as const : "error" as const, title: titles[error.kind], message };
}

export function AppShell() {
  const [overview, setOverview] = useState(true);
  const [architecture, setArchitecture] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>("Dashboard");
  const [railActive, setRailActive] = useState("Dashboard");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [activeId, setActiveId] = useState<number>();
  const [submitting, setSubmitting] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const messageId = useRef(0);
  const submittingRef = useRef(false);
  const [evidence, setEvidence] = useState<{ option: RecoveryOption; scenario: Scenario }>();
  const [modal, setModal] = useState<"settings" | "network" | "profile" | "help">();
  const [compact, setCompact] = useState(false);
  const [date, setDate] = useState(operation.date);
  const [toast, setToast] = useState("");

  const go = (next: Workspace) => {
    setWorkspace(next);
    setRailActive(next === "Timeline" ? "Operations" : next === "Day Brief" ? "Recovery / Exceptions" : next);
  };
  const startBlankAnalysis = () => {
    setOverview(false);
    go("CrewOps AI");
    setActiveId(0);
    setFocusToken(value => value + 1);
  };

  /** Single frontend execution path for typed and guided operational queries. */
  const runQuery = async (question: string): Promise<boolean> => {
    const normalized = question.trim();
    if (!normalized || submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    const id = ++messageId.current;
    setMessages(current => [...current, { id, query: normalized, state: "loading" }]);
    setActiveId(id);
    setOverview(false);
    go("CrewOps AI");
    setDate(operation.date);
    try {
      const scenario = await queryAgent(normalized);
      setMessages(current => current.map(message => message.id === id ? { ...message, scenario, state: undefined } : message));
      return true;
    } catch (error) {
      const presentation = errorPresentation(error);
      setMessages(current => current.map(message => message.id === id ? { ...message, state: presentation.state, errorTitle: presentation.title, error: presentation.message } : message));
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setFocusToken(value => value + 1);
    }
  };
  const runScenario = (id: ScenarioId) => {
    const guided = liveScenarios.find(item => item.id === id);
    if (!guided) {
      startBlankAnalysis();
      setToast("The duty-limit watchlist is informational. Choose a supported disruption analysis.");
      return;
    }
    void runQuery(guided.query);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        startBlankAnalysis();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (overview) return <><ProjectOverview onOpen={startBlankAnalysis} onArchitecture={() => setArchitecture(true)} />{architecture && <Architecture onClose={() => setArchitecture(false)} />}</>;

  const activeScenario = (messages.find(message => message.id === activeId) ?? messages.at(-1))?.scenario;
  return (
    <div className={`app-shell ${compact ? "compact" : ""}`}>
      <Sidebar railActive={railActive} railClick={label => {
        setRailActive(label);
        setWorkspace(label === "Operations" ? "Timeline" : label === "Recovery / Exceptions" ? "Day Brief" : label === "Crew" ? "Dashboard" : label as Workspace);
      }} setModal={setModal} />
      <div className="shell-content">
        <TopBar go={go} compact={compact} setCompact={setCompact} setModal={setModal} onScenario={runScenario} />
        <div className="public-workspace-bar">
          <button className="text-link" onClick={() => setOverview(true)}><ChevronLeft size={14} /> Project overview</button>
          <span>{product.principle}</span>
          <button className="text-link" onClick={() => setArchitecture(true)}>Architecture <GitBranch size={14} /></button>
        </div>
        <div className="workspace-nav">
          <nav aria-label="Workspaces">{tabs.map(tab => <button key={tab.name} onClick={() => go(tab.name)} className={workspace === tab.name ? "active" : ""}><tab.icon size={14} />{tab.name}{tab.name === "CrewOps AI" && <span className="new-tag">LIVE</span>}</button>)}</nav>
          <div className="workspace-context"><span className="live-dot" /> BLR OPERATIONS <span className="context-divider" /><Clock3 size={12} /> UTC</div>
        </div>
        <div className="date-toolbar">
          <div className="inline"><CalendarDays size={14} /><span className="selected-date">{date}</span></div>
          <div className="date-note"><span>Operational week</span><strong>14 — 20 Sep 2026</strong><Badge tone="muted">SYNTHETIC SNAPSHOT</Badge></div>
        </div>
        <div className="workspace-content">
          {date !== operation.date ? <div className="no-snapshot"><CalendarDays size={32} /><h1>No operational snapshot for {date}</h1><p>The portfolio dataset includes an operational snapshot for 14 September 2026.</p><button className="button primary" onClick={() => setDate(operation.date)}>Return to Sep 14 <ArrowRight size={14} /></button></div>
          : workspace === "Dashboard" ? <Dashboard key={railActive} crewOnly={railActive === "Crew"} onScenario={runScenario} onTimeline={() => go("Timeline")} onNetwork={() => setModal("network")} />
          : workspace === "Timeline" ? <Timeline onScenario={runScenario} onNetwork={() => setModal("network")} />
          : workspace === "Day Brief" ? <DayBrief onScenario={runScenario} />
          : <CrewOpsWorkspace messages={messages} activeId={activeId} setActiveId={setActiveId} onEvidence={(option, scenario) => setEvidence({ option, scenario })} onNetwork={() => setModal("network")} onRunQuery={runQuery} onNewBlank={startBlankAnalysis} submitting={submitting} focusToken={focusToken} />}
        </div>
        <footer className="status-bar"><span><span className="live-dot" /> Analysis service ready</span><span>{product.name.toUpperCase()} <i /> {operation.snapshot} <i /> SYNTHETIC OPERATIONAL DATASET</span></footer>
      </div>
      {evidence && <EvidenceDrawer {...evidence} onClose={() => setEvidence(undefined)} />}
      {architecture && <Architecture onClose={() => setArchitecture(false)} />}
      {modal && <Modal title={modal === "network" ? "Operational network" : modal === "settings" ? "Workspace settings" : modal === "help" ? `Welcome to ${product.name}` : "Operations controller"} subtitle={modal === "network" ? "8 stations · BLR hub · schematic view" : `${product.name} · Crew Operations`} onClose={() => setModal(undefined)}>
        <div className="modal-body">
          {modal === "network" ? <Network closed={activeScenario?.id === "closure"} onClosure={() => { setModal(undefined); runScenario("closure"); }} />
          : modal === "settings" ? <><div className="settings-row"><div><strong>Compact display</strong><p>Reduce table row spacing for a denser workspace.</p></div><button role="switch" aria-checked={compact} aria-label="Compact display" className={`switch ${compact ? "on" : ""}`} onClick={() => setCompact(!compact)}><span /></button></div><div className="settings-row"><span>Time convention</span><Badge tone="blue">UTC</Badge></div><div className="settings-row"><span>Data source</span><Badge tone="warning">SYNTHETIC DATASET</Badge></div><p className="muted">Operational analyses use the backend API. The displayed schedule is a fixed synthetic snapshot and no airline systems are connected.</p></>
          : modal === "profile" ? <><div className="profile-identity"><span className="profile-avatar">AK</span><div><h3>A. Kumar</h3><p>Operations Controller · Bengaluru</p></div></div><div className="settings-row"><span>Workspace access</span><Badge tone="blue">PORTFOLIO OPERATOR</Badge></div><div className="settings-row"><span>Active shift</span><strong>06:00–14:00 UTC</strong></div></>
          : <><p>Review flight coverage on the dashboard, explore the timeline, or open CrewOps AI to examine a disruption.</p><div className="help-steps"><span><LayoutDashboard size={17} /> Review the operational snapshot</span><span><Sparkles size={17} /> Choose one of five live analyses</span><span><ShieldCheck size={17} /> Inspect legal recovery and evidence</span></div><button className="button primary" onClick={() => { setModal(undefined); runScenario("sick"); }}>Analyze a sick-crew disruption <ArrowRight size={14} /></button></>}
        </div>
      </Modal>}
      {toast && <div className="toast" role="status"><ShieldCheck size={16} />{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={13} /></button></div>}
    </div>
  );
}
