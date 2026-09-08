import { briefPriorities } from "../../data/mocks";
import {
  ArrowRight,
  CalendarDays,
  CheckCheck,
  Clock3,
  FileWarning,
  Sparkles,
  UserRoundMinus,
} from "lucide-react";
import type { ScenarioId } from "../../types/operations";
import { Badge, PanelTitle } from "../ui";
import { MetricsGrid } from "../dashboard/Dashboard";

const priorityIcons = {
  sick: UserRoundMinus,
  delay: Clock3,
  certification: FileWarning,
};
const priorities = briefPriorities.map((item) => ({
  ...item,
  icon: priorityIcons[item.id],
}));
export function DayBrief({
  onScenario,
}: {
  onScenario: (id: ScenarioId) => void;
}) {
  return (
    <div className="workspace-scroll">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            <CalendarDays size={13} /> DAY BRIEF
          </div>
          <h1>Your shift, in focus.</h1>
          <p>
            Sep 14 · BLR Operations <span className="separator">/</span> Morning
            handover · 05:42 UTC
          </p>
        </div>
        <Badge tone="blue">OPERATIONAL BRIEF</Badge>
      </div>
      <MetricsGrid onScenario={onScenario} />
      <div className="brief-columns">
        <section className="panel">
          <PanelTitle title="Priority exceptions" eyebrow="ATTENTION REQUIRED">
            <Badge tone="warning">3 priorities</Badge>
          </PanelTitle>
          {priorities.map((item, index) => (
            <div className={`priority-row accent-${item.tone}`} key={item.id}>
              <span className="priority-number">0{index + 1}</span>
              <item.icon size={20} />
              <div>
                <h3>{item.title}</h3>
                <p>{item.context}</p>
                <small>{item.detail}</small>
              </div>
              <div className="priority-action">
                <Badge tone={item.tone}>{item.status}</Badge>
                <button
                  className="text-link"
                  onClick={() => onScenario(item.id)}
                >
                  Analyze
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ))}
          <div className="brief-summary">
            <CheckCheck size={16} />
            <span>
              All three priorities have modeled intervention paths. Review the
              evidence before taking operational action.
            </span>
          </div>
        </section>
        <section className="panel reserve-brief">
          <PanelTitle title="Reserve position">
            <Badge tone="success">BLR</Badge>
          </PanelTitle>
          <div className="reserve-total">
            <strong>16</strong>
            <span>total available reserves</span>
          </div>
          <div className="reserve-brief-split">
            <div>
              <strong>8</strong>
              <span>Pilots</span>
            </div>
            <div>
              <strong>8</strong>
              <span>Cabin crew</span>
            </div>
          </div>
          <p>
            Mock availability for this shift.
            <br />
            Assignment legality is shown in each recovery analysis.
          </p>
          <button className="button" onClick={() => onScenario("multi")}>
            Explore joint allocation
            <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel recommended-actions">
        <PanelTitle
          title="Recommended actions"
          eyebrow="CONTINUE IN CREWOPS AI"
        >
          <Sparkles size={18} />
        </PanelTitle>
        <div>
          {priorities.map((item) => (
            <button key={item.id} onClick={() => onScenario(item.id)}>
              <div className="ai-icon">
                <item.icon size={17} />
              </div>
              <span>
                {item.action}
                <small>Open structured impact & decision evidence</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </section>
      <div className="brief-footnote">
        Prepared from the fixed synthetic snapshot · {operationNote}
      </div>
    </div>
  );
}
const operationNote =
  "No live data connection. No operational changes applied.";
