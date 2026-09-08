import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FileWarning,
  GitBranch,
  Plane,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRoundMinus,
  Users,
} from "lucide-react";
import { cabinRows, metrics, operation, pilotRows } from "../../data/mocks";
import type { ScenarioId } from "../../types/operations";
import { Badge, PanelTitle, TextLink } from "../ui";
import { ReviewQueue } from "../timeline/ReviewQueue";

const icons = {
  crew: Users,
  connection: GitBranch,
  clock: Clock3,
  check: UserCheck,
  reserve: ShieldCheck,
  document: FileWarning,
  absence: UserRoundMinus,
};
export function MetricsGrid({
  onScenario,
}: {
  onScenario: (id: ScenarioId) => void;
}) {
  const routes: ScenarioId[] = [
    "sick",
    "delay",
    "limits",
    "sick",
    "multi",
    "certification",
    "multi",
  ];
  return (
    <div className="metrics-grid">
      {metrics.map((metric, index) => {
        const Icon = icons[metric.icon];
        return (
          <button
            key={metric.label}
            className={`metric-card accent-${metric.tone}`}
            onClick={() => onScenario(routes[index])}
          >
            <div className="metric-top">
              <span>{metric.label}</span>
              <Icon size={15} />
            </div>
            <div className="metric-value">
              {metric.value}
              <ArrowUpRight size={14} />
            </div>
            <small>{metric.detail}</small>
          </button>
        );
      })}
    </div>
  );
}
export function FtlTable({
  onScenario,
  initialTab = "Pilots",
}: {
  onScenario: (id: ScenarioId) => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  const rows = (tab === "Pilots" ? pilotRows : cabinRows).filter((row) =>
    `${row.id} ${row.name} ${row.rank}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="panel ftl-panel">
      <PanelTitle title="Flight Time Limits (FTL)" eyebrow="CREW COMPLIANCE">
        <Badge tone="warning">4 require attention</Badge>
      </PanelTitle>
      <div className="table-toolbar">
        <div className="under-tabs">
          {["Pilots", "Flight Attendants"].map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
              <span>{item === "Pilots" ? "57" : "93"}</span>
            </button>
          ))}
        </div>
        <label className="search-input">
          <Search size={14} />
          <input
            aria-label="Search FTL crew"
            placeholder="Search crew…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "ID",
                "NAME",
                "RANK",
                "24H",
                "7D",
                "28D",
                "LIMIT",
                "STATUS",
                "ACTION",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="mono text-bright">{row.id}</td>
                <td>
                  <div className="crew-name">
                    <span className="initials">{row.initials}</span>
                    <div>
                      {row.name}
                      <small>{row.aircraft}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="rank">{row.rank}</span>
                </td>
                <td className="mono">{row.h24}</td>
                <td className={`mono cell-${row.tone}`}>{row.d7}</td>
                <td className="mono">{row.d28}</td>
                <td className="mono muted">{row.limit}</td>
                <td>
                  <Badge tone={row.tone}>{row.status}</Badge>
                </td>
                <td>
                  <button
                    className="table-action"
                    aria-label={`Review ${row.id}`}
                    onClick={() =>
                      onScenario(
                        row.id === "C-1042"
                          ? "sick"
                          : tab === "Pilots"
                            ? "limits"
                            : "certification",
                      )
                    }
                  >
                    <ArrowUpRight size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty-row">No crew match “{search}”.</p>
        )}
      </div>
      <div className="panel-footer">
        <span>{rows.length} displayed · selected operational watchlist</span>
        <span>All values HH:MM · UTC calendar windows</span>
      </div>
    </section>
  );
}
export function Dashboard({
  onScenario,
  onTimeline,
  onNetwork,
  crewOnly = false,
}: {
  onScenario: (id: ScenarioId) => void;
  onTimeline: () => void;
  onNetwork: () => void;
  crewOnly?: boolean;
}) {
  return (
    <div className="workspace-scroll">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> OPERATIONS CONTROL CENTER
          </div>
          <h1>{crewOnly ? "Crew compliance" : "Operations overview"}</h1>
          <p>
            {operation.dateLabel} <span className="separator">/</span> Bengaluru
            hub
          </p>
        </div>
        <div className="inline">
          <button className="button" onClick={onNetwork}>
            <GitBranch size={14} />
            Network view
          </button>
          <button className="button primary" onClick={() => onScenario("sick")}>
            <Sparkles size={14} />
            Open CrewOps AI
            <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <MetricsGrid onScenario={onScenario} />
      <div className="dashboard-columns">
        <div className="main-column">
          <FtlTable onScenario={onScenario} />
          <div className="lower-panels">
            <section className="panel">
              <PanelTitle title="Reserve position">
                <Badge tone="success">READY</Badge>
              </PanelTitle>
              <div className="reserve-overview">
                <div className="reserve-number">
                  16<span>available at BLR</span>
                </div>
                <div className="reserve-split">
                  <div>
                    <span>
                      <i className="dot blue" />
                      Pilots
                    </span>
                    <strong>8</strong>
                  </div>
                  <div>
                    <span>
                      <i className="dot success" />
                      Cabin crew
                    </span>
                    <strong>8</strong>
                  </div>
                  <div className="stacked-bar">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
              <div className="panel-footer">
                <span>
                  <ShieldCheck size={12} /> Availability verified in snapshot
                </span>
                <TextLink onClick={() => onScenario("multi")}>
                  Explore cover
                </TextLink>
              </div>
            </section>
            <section className="panel operation-health">
              <PanelTitle title="Operation at a glance">
                <Plane size={16} />
              </PanelTitle>
              <div className="health-metrics">
                <div>
                  <strong>147</strong>
                  <span>Scheduled flights</span>
                </div>
                <div>
                  <strong>8</strong>
                  <span>Network stations</span>
                </div>
                <div>
                  <strong className="text-success">96.8%</strong>
                  <span>Mock on-time target</span>
                </div>
              </div>
              <div className="panel-footer">
                <span>
                  <Clock3 size={12} /> Next bank · 06:00 UTC
                </span>
                <TextLink onClick={onTimeline}>Open timeline</TextLink>
              </div>
            </section>
          </div>
          <div className="advisor-strip">
            <div className="ai-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>A clearer path through operational disruption.</strong>
              <p>
                Explore impact, legal recovery and the evidence behind every
                option.
              </p>
            </div>
            <button onClick={() => onScenario("sick")} className="text-link">
              Ask CrewOps
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <ReviewQueue onScenario={onScenario} />
      </div>
    </div>
  );
}
