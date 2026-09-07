import { useState } from "react";
import {
  ArrowRight,
  Columns3,
  GitBranch,
  List,
  Plane,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { timelineFlights } from "../../data/mocks";
import type { ScenarioId, TimelineFlight } from "../../types/operations";
import { Badge, Modal } from "../ui";
import { ReviewQueue } from "./ReviewQueue";

const blocks = [
  "All Day",
  "Block 1|06:00–08:59",
  "Block 2|09:00–10:59",
  "Block 3|11:00–14:59",
  "Block 4|15:00–17:59",
  "Block 5|18:00–20:59",
  "Block 6|21:00–24:00",
];
const hours = [
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00",
  "18:00",
  "20:00",
  "22:00",
  "24:00",
];
export function Timeline({
  onScenario,
  onNetwork,
}: {
  onScenario: (id: ScenarioId) => void;
  onNetwork: () => void;
}) {
  const [block, setBlock] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("Timeline");
  const [direction, setDirection] = useState("All");
  const [base, setBase] = useState("BLR");
  const [selected, setSelected] = useState<TimelineFlight>();
  const [risksOnly, setRisksOnly] = useState(false);
  const rows = timelineFlights.filter(
    (flight) =>
      (!block || flight.block === block) &&
      (direction === "All" ||
        (direction === "DEP"
          ? flight.origin === base
          : flight.destination === base)) &&
      (flight.origin === base || flight.destination === base) &&
      (!risksOnly || flight.state === "critical" || flight.state === "risk") &&
      `${flight.id} ${flight.origin} ${flight.destination}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="workspace-scroll">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> NETWORK OPERATIONS
          </div>
          <h1>Flight timeline</h1>
          <p>
            Flight coverage, crew readiness and disruption exposure{" "}
            <span className="separator">/</span> All times UTC
          </p>
        </div>
        <button className="button" onClick={onNetwork}>
          <GitBranch size={14} />
          Network view
        </button>
      </div>
      <div className="block-tabs">
        {blocks.map((item, index) => (
          <button
            className={block === index ? "active" : ""}
            key={item}
            onClick={() => setBlock(index)}
          >
            {item.split("|")[0]}
            {item.includes("|") && <small>{item.split("|")[1]}</small>}
          </button>
        ))}
      </div>
      <div className="dashboard-columns timeline-columns">
        <section className="panel timeline-panel">
          <div className="timeline-toolbar">
            <label className="search-input">
              <Search size={14} />
              <input
                aria-label="Search flights"
                placeholder="Flight or station…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="base-select">
              Base{" "}
              <select
                aria-label="Timeline base"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              >
                {["BLR", "HYD", "BOM", "MAA", "CCU", "COK"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <div className="segmented">
              {["All", "DEP", "ARR"].map((item) => (
                <button
                  key={item}
                  onClick={() => setDirection(item)}
                  className={direction === item ? "active" : ""}
                >
                  {item}
                </button>
              ))}
            </div>
            <button
              className={`icon-button ${risksOnly ? "selected" : ""}`}
              aria-label="Show only flights at risk"
              aria-pressed={risksOnly}
              onClick={() => setRisksOnly(!risksOnly)}
            >
              <SlidersHorizontal size={15} />
            </button>
            <div className="segmented view-toggle">
              {["Timeline", "Table"].map((item) => (
                <button
                  key={item}
                  className={view === item ? "active" : ""}
                  onClick={() => setView(item)}
                >
                  {item === "Timeline" ? (
                    <Columns3 size={13} />
                  ) : (
                    <List size={13} />
                  )}
                  {item}
                </button>
              ))}
            </div>
          </div>
          {view === "Timeline" ? (
            <div className="timeline-scroll">
              <div className="timeline-grid">
                <div className="timeline-head">
                  <div>FLIGHT / ROUTE</div>
                  <div className="hours">
                    {hours.map((hour) => (
                      <span key={hour}>{hour}</span>
                    ))}
                  </div>
                </div>
                {rows.map((flight) => (
                  <div className="timeline-row" key={flight.id}>
                    <button
                      className="flight-label"
                      onClick={() => setSelected(flight)}
                    >
                      <strong>
                        {flight.id}
                        <span>
                          {flight.crew}
                          <UsersIcon />
                        </span>
                      </strong>
                      <small>
                        {flight.origin}
                        <ArrowRight size={10} />
                        {flight.destination}
                        <span>{flight.aircraft.split(" · ")[0]}</span>
                      </small>
                    </button>
                    <div className="time-lane">
                      <button
                        className={`flight-bar ${flight.state}`}
                        style={{
                          left: `${flight.left}%`,
                          width: `${flight.width}%`,
                        }}
                        onClick={() => setSelected(flight)}
                        aria-label={`${flight.id} ${flight.status}, ${flight.departure} to ${flight.arrival}`}
                      >
                        <Plane size={12} />
                        <span>{flight.id}</span>
                      </button>
                      <span
                        className="flight-bar-caption"
                        style={{ left: `${Math.min(flight.left, 82)}%` }}
                      >
                        {flight.departure} — {flight.arrival}
                      </span>
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <p className="empty-row">No flights match these filters.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "FLIGHT",
                      "ROUTE",
                      "DEP · UTC",
                      "ARR · UTC",
                      "CREW",
                      "STATUS",
                      "",
                    ].map((text, i) => (
                      <th key={i}>{text}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((flight) => (
                    <tr key={flight.id}>
                      <td className="mono text-bright">{flight.id}</td>
                      <td>
                        {flight.origin} → {flight.destination}
                      </td>
                      <td className="mono">{flight.departure}</td>
                      <td className="mono">{flight.arrival}</td>
                      <td>{flight.crew}</td>
                      <td>
                        <Badge tone={flight.state}>{flight.status}</Badge>
                      </td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => setSelected(flight)}
                        >
                          Inspect
                          <ArrowRight size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="empty-row">No flights match these filters.</p>
              )}
            </div>
          )}
          <div className="timeline-legend">
            <span>
              <i className="dot blue" />
              Scheduled
            </span>
            <span>
              <i className="dot success" />
              Confirmed / recovered
            </span>
            <span>
              <i className="dot purple" />
              Affected / FTL watch
            </span>
            <span>
              <i className="dot danger" />
              Recovery required
            </span>
          </div>
          <div className="panel-footer">
            <span>{rows.length} flights displayed · curated demo rotation</span>
            <span>14 Sep · UTC</span>
          </div>
        </section>
        <ReviewQueue onScenario={onScenario} />
      </div>
      {selected && (
        <Modal
          title={`${selected.id} · Flight details`}
          subtitle={`${selected.date} · ${selected.aircraft}`}
          onClose={() => setSelected(undefined)}
        >
          <div className="modal-body">
            <div className="flight-route">
              <div>
                <strong>{selected.origin}</strong>
                <span>{selected.departure} UTC</span>
              </div>
              <Plane />
              <div>
                <strong>{selected.destination}</strong>
                <span>{selected.arrival} UTC</span>
              </div>
            </div>
            <div className="spread">
              <span>
                Crew assigned <strong>{selected.crew}</strong>
              </span>
              <Badge tone={selected.state}>{selected.status}</Badge>
            </div>
            <p className="muted">
              Mock schedule and crew coverage. Open an available CrewOps
              scenario to explore operational consequences.
            </p>
            <button
              className="button primary"
              onClick={() => {
                setSelected(undefined);
                onScenario("delay");
              }}
            >
              Explore delay demo
              <ArrowRight size={14} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function UsersIcon() {
  return <span className="crew-mini">crew</span>;
}
