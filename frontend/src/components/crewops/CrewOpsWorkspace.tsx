import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Clock3,
  Command,
  FileCheck2,
  GitBranch,
  History,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  operation,
  promptIds,
  recognizeQuery,
  scenarios,
} from "../../data/mocks";
import type {
  AssistantMessage,
  RecoveryOption,
  Scenario,
  ScenarioId,
} from "../../types/operations";
import { Badge } from "../ui";
import { ScenarioResult } from "./ScenarioResult";

export function CrewOpsWorkspace({
  messages,
  onMessages,
  activeId,
  setActiveId,
  onEvidence,
  onNetwork,
  onSickQuestion,
  onDelayQuestion,
  onStationClosureQuestion,
  onCertificationQuestion,
  onMultiSickQuestion,
}: {
  messages: AssistantMessage[];
  onMessages: (messages: AssistantMessage[]) => void;
  activeId?: number;
  setActiveId: (id: number | undefined) => void;
  onEvidence: (option: RecoveryOption, scenario: Scenario) => void;
  onNetwork: () => void;
  onSickQuestion: (question: string) => void;
  onDelayQuestion: (question: string) => void;
  onStationClosureQuestion: (question: string) => void;
  onCertificationQuestion: (question: string) => void;
  onMultiSickQuestion: (question: string) => void;
}) {
  const [query, setQuery] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active =
    activeId === 0
      ? undefined
      : (messages.find((item) => item.id === activeId) ?? messages.at(-1));
  const submit = (text: string, scenarioId?: ScenarioId) => {
    if (!text.trim()) return;
    const id = scenarioId ?? recognizeQuery(text);
    if (id === "sick" || (/\bC-\d{4}\b/i.test(text) && /\b(?:sick|unavailable)\b/i.test(text) && (text.match(/\bC-\d{4}\b/gi)?.length ?? 0) === 1)) {
      onSickQuestion(text.trim());
      setQuery("");
      scroll.current?.scrollTo({ top: 0 });
      return;
    }
    if (id === "delay" || (/\b(?:delay|delayed)\s+DX\d+\s+(?:by\s+)?\d+\s*(?:minutes?|mins?|m)\b/i.test(text))) {
      onDelayQuestion(text.trim());
      setQuery("");
      scroll.current?.scrollTo({ top: 0 });
      return;
    }
    if (id === "closure" || /\b(?:close|closed|closure)\b/i.test(text) && /\b[A-Z]{3}\b/i.test(text) && /\b\d{1,2}:\d{2}\b/.test(text)) {
      onStationClosureQuestion(text.trim());
      setQuery("");
      scroll.current?.scrollTo({ top: 0 });
      return;
    }
    if (id === "certification" || /\bC-\d{4}\b/i.test(text) && /\b(?:certification|cert|expire[sd]?|expiry|training|legal\s+for\s+duty)\b/i.test(text)) {
      onCertificationQuestion(text.trim());
      setQuery("");
      scroll.current?.scrollTo({ top: 0 });
      return;
    }
    if (id === "multi" || /\b(?:simultaneous|two|three|multiple|recover)\b/i.test(text) && /\b(?:sick|unavailable)\b/i.test(text) && (text.match(/\bC-\d{4}\b/gi)?.length ?? 0) >= 2) {
      onMultiSickQuestion(text.trim());
      setQuery("");
      scroll.current?.scrollTo({ top: 0 });
      return;
    }
    const message: AssistantMessage = {
      id: (messages.at(-1)?.id ?? 0) + 1,
      query: text.trim(),
      scenario: id ? scenarios[id] : undefined,
      generic: !id,
    };
    onMessages([...messages, message]);
    setActiveId(message.id);
    setQuery("");
    scroll.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="crewops-layout">
      <aside className="copilot-sidebar">
        <div className="copilot-brand">
          <div className="ai-icon">
            <Sparkles size={19} />
          </div>
          <div>
            <strong>CrewOps Advisor</strong>
            <span>Operational intelligence</span>
          </div>
        </div>
        <button
          className="button new-analysis"
          onClick={() => {
            setActiveId(0);
            setQuery("");
            input.current?.focus();
          }}
        >
          <Plus size={15} />
          New analysis<span>⌘ K</span>
        </button>
        <div className="sidebar-section-title">
          <History size={13} />
          THIS SESSION{" "}
          <span>{messages.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="analysis-history">
          {messages.length === 0 ? (
            <p className="muted sidebar-empty">
              Your analyses will appear here.
            </p>
          ) : (
            [...messages].reverse().map((item) => (
              <button
                className={active?.id === item.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveId(item.id);
                  scroll.current?.scrollTo({ top: 0 });
                }}
              >
                <MessageSquare size={14} />
                <span>{item.query}</span>
                <ChevronRight size={12} />
              </button>
            ))
          )}
        </div>
        <div className="sidebar-section-title">
          <FileCheck2 size={13} />
          DEMO SCENARIOS
        </div>
        <div className="scenario-nav">
          {promptIds
            .filter((id) => id !== "limits")
            .map((id, index) => (
              <button key={id} onClick={() => submit(scenarios[id].query, id)}>
                <span className="scenario-number">0{index + 1}</span>
                <span>{scenarios[id].label}</span>
                <ArrowUp size={12} />
              </button>
            ))}
        </div>
        <div className="sidebar-trust">
          <ShieldCheck size={20} />
          <strong>Every decision. Explained.</strong>
          <p>
            Traceable legality, exact costs and transparent recovery options.
          </p>
          <div>
            <span className="live-dot" />
            Mock operational data
          </div>
        </div>
      </aside>
      <main className="copilot-main">
        <header className="copilot-header">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> LIVE OPERATIONS WORKSPACE
            </div>
            <h1>Crew recovery desk</h1>
            <p>Deterministic disruption analysis and recovery planning</p>
          </div>
          <button className="text-link" onClick={onNetwork}>
            <GitBranch size={14} />
            Network view
            <ChevronRight size={14} />
          </button>
        </header>
        <div className="context-strip">
          <span>
            <strong>{operation.flights}</strong> flights
          </span>
          <span>
            <strong>{operation.crew}</strong> crew
          </span>
          <span>
            <strong>{operation.reserves}</strong> reserves
          </span>
          <span className="hub-marker">BLR hub</span>
          <span className="snapshot-label">DEMO SNAPSHOT · 14 SEP 2026</span>
        </div>
        <div className="conversation-scroll" ref={scroll}>
          {!active ? (
            <div className="empty-copilot">
              <div className="empty-emblem">
                <Sparkles size={30} />
                <span />
              </div>
              <div className="eyebrow">
                YOUR OPERATION. A CLEARER NEXT MOVE.
              </div>
              <h2>How can I help with today’s operation?</h2>
              <p>
                Ask about crew availability, legality, disruptions,
                <br />
                delays and recovery options.
              </p>
              <div className="prompt-grid">
                {promptIds.slice(0, 4).map((id, index) => (
                  <button
                    key={id}
                    onClick={() => submit(scenarios[id].query, id)}
                  >
                    <span className={`prompt-icon prompt-${index}`}>
                      {index === 1 ? (
                        <Clock3 size={16} />
                      ) : index === 2 ? (
                        <ShieldCheck size={16} />
                      ) : index === 3 ? (
                        <GitBranch size={16} />
                      ) : (
                        <MessageSquare size={16} />
                      )}
                    </span>
                    <span>{scenarios[id].query}</span>
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
              <div className="empty-footnote">
                <ShieldCheck size={13} />
                Deterministic rules. Transparent reasoning. Operator in control.
              </div>
            </div>
          ) : (
            <div className="conversation">
              <div className="operator-query">
                <div className="small-avatar">AK</div>
                <div>
                  <span className="eyebrow">
                    YOU <span>· OPERATIONS CONTROLLER</span>
                  </span>
                  <p>{active.query}</p>
                </div>
              </div>
              <div className="assistant-heading">
                <div className="ai-icon">
                  <Sparkles size={16} />
                </div>
                <strong>CrewOps Advisor</strong>
                <Badge tone="blue">ANALYSIS</Badge>
                <span className="muted">{active.scenario?.live ? "Deterministic API" : "Demo response"}</span>
              </div>
              {active.state === "loading" ? (
                <div className="api-state" role="status">
                  <span className="api-spinner" />
                  <div><strong>Analyzing sick-crew impact</strong><p>Resolving pairings, deterministic legality and ranked recovery options.</p></div>
                </div>
              ) : active.state === "error" ? (
                <div className="api-state error" role="alert">
                  <div><strong>Analysis unavailable</strong><p>{active.error}</p><small>No mock result has been substituted. The displayed operation remains unchanged.</small></div>
                </div>
              ) : active.state === "empty" ? (
                <div className="api-state"><div><strong>No affected duties returned</strong><p>The deterministic service completed without an operational result for this request.</p></div></div>
              ) : active.scenario ? (
                <ScenarioResult
                  scenario={active.scenario}
                  onEvidence={onEvidence}
                />
              ) : (
                <div className="generic-response">
                  <h2>Let’s explore an operational scenario.</h2>
                  <p>
                    This preview supports the six prepared analyses below. Your
                    query hasn’t been evaluated by the backend; choose a demo to
                    see structured impact, recovery and evidence.
                  </p>
                  <div className="prompt-grid">
                    {promptIds.map((id) => (
                      <button
                        key={id}
                        onClick={() => submit(scenarios[id].query, id)}
                      >
                        <span>{scenarios[id].query}</span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                className="another-analysis"
                onClick={() => {
                  input.current?.focus();
                  scroll.current?.scrollTo({
                    top: scroll.current.scrollHeight,
                    behavior: "smooth",
                  });
                }}
              >
                Ask a follow-up
                <ArrowDown size={13} />
              </button>
            </div>
          )}
        </div>
        <div className="command-area">
          <form
            className="command-input"
            onSubmit={(event) => {
              event.preventDefault();
              submit(query);
            }}
          >
            <Command size={18} />
            <textarea
              ref={input}
              rows={1}
              aria-label="CrewOps command"
              placeholder="Ask about crew, flights, delays, closures…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  submit(query);
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send query"
              disabled={!query.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </form>
          <div className="command-help">
            <span>
              <ShieldCheck size={11} />
              Mock demo · no live operational actions
            </span>
            <span>
              Enter to send <span className="keycap">↵</span> <i />
              Shift + Enter for a new line
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
