import { Sidebar } from "../components/layout/Sidebar";
import { TopBar } from "../components/layout/TopBar";
import { Network } from "../components/layout/Network";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AssistantMessage,
  RecoveryOption,
  Scenario,
  ScenarioId,
  Workspace,
} from "../types/operations";
import { operation, scenarios } from "../data/mocks";
import { CrewOpsApiError, queryCertificationExpiry, queryDelay, queryMultiSick, querySickCrew, queryStationClosure } from "../api/crewops";
import { Dashboard } from "../components/dashboard/Dashboard";
import { Timeline } from "../components/timeline/Timeline";
import { DayBrief } from "../components/daybrief/DayBrief";
import { CrewOpsWorkspace } from "../components/crewops/CrewOpsWorkspace";
import { EvidenceDrawer } from "../components/crewops/EvidenceDrawer";
import { Badge, Modal } from "../components/ui";

const tabs: { name: Workspace; icon: typeof LayoutDashboard }[] = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Timeline", icon: Activity },
  { name: "Day Brief", icon: CalendarDays },
  { name: "CrewOps AI", icon: Sparkles },
];
export function AppShell() {
  const [workspace, setWorkspace] = useState<Workspace>("Dashboard");
  const [railActive, setRailActive] = useState("Dashboard");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [activeId, setActiveId] = useState<number>();
  const [evidence, setEvidence] = useState<{
    option: RecoveryOption;
    scenario: Scenario;
  }>();
  const [modal, setModal] = useState<
    "settings" | "network" | "profile" | "help"
  >();
  const [compact, setCompact] = useState(false);
  const [date, setDate] = useState(operation.date);
  const [dateLabel, setDateLabel] = useState("Today");
  const [customDate, setCustomDate] = useState(false);
  const [toast, setToast] = useState("");
  const go = (next: Workspace) => {
    setWorkspace(next);
    setRailActive(
      next === "Timeline"
        ? "Operations"
        : next === "Day Brief"
          ? "Recovery / Exceptions"
          : next,
    );
  };
  const addMessage = (message: AssistantMessage) => {
    setMessages((current) => [...current, message]);
    setActiveId(message.id);
    go("CrewOps AI");
    setDate(operation.date);
    setDateLabel("Today");
  };
  const onSickQuestion = async (question: string) => {
    await onLiveQuestion(question, querySickCrew);
  };
  const onDelayQuestion = async (question: string) => {
    await onLiveQuestion(question, queryDelay);
  };
  const onStationClosureQuestion = async (question: string) => {
    await onLiveQuestion(question, queryStationClosure);
  };
  const onCertificationQuestion = async (question: string) => {
    await onLiveQuestion(question, queryCertificationExpiry);
  };
  const onMultiSickQuestion = async (question: string) => {
    await onLiveQuestion(question, queryMultiSick);
  };
  const onLiveQuestion = async (question: string, queryApi: (question: string) => Promise<Scenario>) => {
    const id = (messages.at(-1)?.id ?? 0) + 1;
    addMessage({ id, query: question, state: "loading" });
    try {
      const scenario = await queryApi(question);
      setMessages((current) => current.map((message) => message.id === id ? { ...message, scenario, state: undefined } : message));
    } catch (error) {
      const message = error instanceof Error ? error.message : "CrewOps analysis failed unexpectedly.";
      const state = error instanceof CrewOpsApiError && error.kind === "empty" ? "empty" : "error";
      setMessages((current) => current.map((item) => item.id === id ? { ...item, state, error: message } : item));
    }
  };
  const onScenario = (id: ScenarioId) => {
    const scenario = scenarios[id];
    if (id === "sick") {
      void onSickQuestion(scenario.query);
      return;
    }
    if (id === "delay") {
      void onDelayQuestion(scenario.query);
      return;
    }
    if (id === "closure") {
      void onStationClosureQuestion(scenario.query);
      return;
    }
    if (id === "certification") {
      void onCertificationQuestion(scenario.query);
      return;
    }
    if (id === "multi") {
      void onMultiSickQuestion(scenario.query);
      return;
    }
    const message: AssistantMessage = {
      id: (messages.at(-1)?.id ?? 0) + 1,
      query: scenario.query,
      scenario,
    };
    addMessage(message);
  };
  const onEvidence = (option: RecoveryOption, scenario: Scenario) =>
    setEvidence({ option, scenario });
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setWorkspace("CrewOps AI");
        setRailActive("CrewOps AI");
        setActiveId(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shiftDate = (offset: number) => {
    const selected = new Date((date || operation.date) + "T00:00:00Z");
    selected.setUTCDate(selected.getUTCDate() + offset);
    setDate(selected.toISOString().slice(0, 10));
    setDateLabel("Custom");
  };
  const railClick = (label: string) => {
    setRailActive(label);
    setWorkspace(
      label === "Operations"
        ? "Timeline"
        : label === "Recovery / Exceptions"
          ? "Day Brief"
          : label === "Crew"
            ? "Dashboard"
            : (label as Workspace),
    );
  };
  return (
    <div className={`app-shell ${compact ? "compact" : ""}`}>
      <Sidebar
        railActive={railActive}
        railClick={railClick}
        setModal={setModal}
      />
      <div className="shell-content">
        <TopBar
          go={go}
          compact={compact}
          setCompact={setCompact}
          setModal={setModal}
          setToast={setToast}
          onScenario={onScenario}
        />
        <div className="workspace-nav">
          <nav aria-label="Workspaces">
            {tabs.map((tab) => (
              <button
                key={tab.name}
                onClick={() => go(tab.name)}
                className={workspace === tab.name ? "active" : ""}
              >
                <tab.icon size={14} />
                {tab.name}
                {tab.name === "CrewOps AI" && (
                  <span className="new-tag">NEW</span>
                )}
              </button>
            ))}
          </nav>
          <div className="workspace-context">
            <span className="live-dot" />
            BLR OPERATIONS
            <span className="context-divider" />
            <Clock3 size={12} />
            UTC
          </div>
        </div>
        <div className="date-toolbar">
          <div className="inline">
            <CalendarDays size={14} />
            <button
              className="date-day icon-button"
              aria-label="Previous day"
              onClick={() => {
                shiftDate(-1);
              }}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="selected-date">{date}</span>
            <button
              className="date-day icon-button"
              aria-label="Next day"
              onClick={() => {
                shiftDate(1);
              }}
            >
              <ChevronRight size={13} />
            </button>
            <div className="date-buttons">
              {["Today", "Tomorrow", "Sep 14", "Sep 15", "Sep 16"].map(
                (label) => (
                  <button
                    key={label}
                    className={dateLabel === label ? "active" : ""}
                    onClick={() => {
                      setDate(
                        label === "Today" || label === "Sep 14"
                          ? "2026-09-14"
                          : label === "Tomorrow" || label === "Sep 15"
                            ? "2026-09-15"
                            : "2026-09-16",
                      );
                      setDateLabel(label);
                      setCustomDate(false);
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            <button
              className={`custom-date-button ${customDate ? "active" : ""}`}
              onClick={() => setCustomDate(!customDate)}
            >
              Custom
              <ChevronDown size={11} />
            </button>
            {customDate && (
              <input
                className="custom-date-input"
                type="date"
                aria-label="Custom operational date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateLabel("Custom");
                }}
              />
            )}
          </div>
          <div className="date-note">
            <span>Operational week</span>
            <strong>14 — 20 Sep 2026</strong>
            <Badge tone="muted">DEMO MODE</Badge>
          </div>
        </div>
        <div className="workspace-content">
          {date !== operation.date ? (
            <div className="no-snapshot">
              <CalendarDays size={32} />
              <h1>No demo snapshot for {date || "this date"}</h1>
              <p>
                This preview includes a fixed operational snapshot for 14
                September 2026.
              </p>
              <button
                className="button primary"
                onClick={() => {
                  setDate(operation.date);
                  setDateLabel("Today");
                }}
              >
                Return to Sep 14
                <ArrowRight size={14} />
              </button>
            </div>
          ) : workspace === "Dashboard" ? (
            <Dashboard
              key={railActive}
              crewOnly={railActive === "Crew"}
              onScenario={onScenario}
              onTimeline={() => go("Timeline")}
              onNetwork={() => setModal("network")}
            />
          ) : workspace === "Timeline" ? (
            <Timeline
              onScenario={onScenario}
              onNetwork={() => setModal("network")}
            />
          ) : workspace === "Day Brief" ? (
            <DayBrief onScenario={onScenario} />
          ) : (
            <CrewOpsWorkspace
              messages={messages}
              onMessages={setMessages}
              activeId={activeId}
              setActiveId={setActiveId}
              onEvidence={onEvidence}
              onNetwork={() => setModal("network")}
              onSickQuestion={onSickQuestion}
            onDelayQuestion={onDelayQuestion}
            onStationClosureQuestion={onStationClosureQuestion}
            onCertificationQuestion={onCertificationQuestion}
            onMultiSickQuestion={onMultiSickQuestion}
            />
          )}
        </div>
        <footer className="status-bar">
          <span>
            <span className="live-dot" /> All demo systems operational
          </span>
          <span>
            CREWOPS ADVISOR <i /> {operation.snapshot} <i /> READ-ONLY PREVIEW
          </span>
        </footer>
      </div>
      {evidence && (
        <EvidenceDrawer {...evidence} onClose={() => setEvidence(undefined)} />
      )}
      {modal && (
        <Modal
          title={
            modal === "network"
              ? "Operational network"
              : modal === "settings"
                ? "Workspace settings"
                : modal === "help"
                  ? "Welcome to CrewOps Advisor"
                  : "Operations controller"
          }
          subtitle={
            modal === "network"
              ? "8 stations · BLR hub · schematic view"
              : "dCortex · Crew Operations"
          }
          onClose={() => setModal(undefined)}
        >
          <div className="modal-body">
            {modal === "network" ? (
              <Network
                closed={
                  (
                    messages.find((message) => message.id === activeId) ??
                    messages.at(-1)
                  )?.scenario?.id === "closure"
                }
                onClosure={() => {
                  setModal(undefined);
                  onScenario("closure");
                }}
              />
            ) : modal === "settings" ? (
              <>
                <div className="settings-row">
                  <div>
                    <strong>Compact display</strong>
                    <p>Reduce table row spacing for a denser workspace.</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={compact}
                    aria-label="Compact display"
                    className={`switch ${compact ? "on" : ""}`}
                    onClick={() => setCompact(!compact)}
                  >
                    <span />
                  </button>
                </div>
                <div className="settings-row">
                  <span>Time convention</span>
                  <Badge tone="blue">UTC</Badge>
                </div>
                <div className="settings-row">
                  <span>Data source</span>
                  <Badge tone="warning">LOCAL DEMO MOCKS</Badge>
                </div>
                <p className="muted">
                  The preview uses fixed display values. No backend connection
                  or operational write actions are enabled.
                </p>
              </>
            ) : modal === "profile" ? (
              <>
                <div className="profile-identity">
                  <span className="profile-avatar">AK</span>
                  <div>
                    <h3>A. Kumar</h3>
                    <p>Operations Controller · Bengaluru</p>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Workspace access</span>
                  <Badge tone="blue">DEMO OPERATOR</Badge>
                </div>
                <div className="settings-row">
                  <span>Active shift</span>
                  <strong>06:00–14:00 UTC</strong>
                </div>
              </>
            ) : (
              <>
                <p>
                  Review flight coverage on the dashboard, explore the timeline,
                  or open CrewOps AI to examine a disruption.
                </p>
                <div className="help-steps">
                  <span>
                    <LayoutDashboard size={17} />
                    Review the operational snapshot
                  </span>
                  <span>
                    <Sparkles size={17} />
                    Choose one of six prepared analyses
                  </span>
                  <span>
                    <ShieldCheck size={17} />
                    Inspect legal recovery and decision evidence
                  </span>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setModal(undefined);
                    onScenario("sick");
                  }}
                >
                  Start the sick-crew demo
                  <ArrowRight size={14} />
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={16} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
