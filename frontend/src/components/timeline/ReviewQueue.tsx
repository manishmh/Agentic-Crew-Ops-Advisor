import { useState } from "react";
import { ArrowUpRight, CheckCheck, MapPin, Sparkles } from "lucide-react";
import { reviewItems } from "../../data/mocks";
import type { ScenarioId } from "../../types/operations";
import { Badge } from "../ui";

export function ReviewQueue({
  onScenario,
}: {
  onScenario: (id: ScenarioId) => void;
}) {
  const [tab, setTab] = useState("Review");
  return (
    <aside className="panel review-queue">
      <div className="queue-tabs">
        {["Review", "Done"].map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item}
            <span>{item === "Review" ? "3" : "2"}</span>
          </button>
        ))}
      </div>
      <div className="queue-body">
        <div className="eyebrow">
          {tab === "Review" ? "UNCREWED DUTIES" : "REVIEWED OPERATIONS"}
          <span className="queue-counter">
            {tab === "Review" ? "03" : "02"}
          </span>
        </div>
        {tab === "Review"
          ? reviewItems.map((item) => (
              <button
                className="queue-item"
                key={item.flight}
                onClick={() => onScenario(item.scenario)}
              >
                <div className="spread">
                  <strong>
                    {item.flight}
                    <span> / {item.date}</span>
                  </strong>
                  <ArrowUpRight size={14} />
                </div>
                <p>
                  {item.role}
                  <span className="mono">{item.pairing}</span>
                </p>
                <div className="spread">
                  <span className="inline muted">
                    <MapPin size={12} />
                    BLR
                  </span>
                  <Badge tone="warning">Awaiting Review</Badge>
                </div>
              </button>
            ))
          : ["DX590 · Reserve confirmed", "DX401 · Check-in resolved"].map(
              (item) => (
                <div className="queue-item done-item" key={item}>
                  <CheckCheck size={16} />
                  <strong>{item}</strong>
                  <Badge tone="success">Reviewed</Badge>
                </div>
              ),
            )}
        <div className="queue-advisor">
          <Sparkles size={18} />
          <strong>Recovery, with reasoning.</strong>
          <p>
            Let CrewOps assess your next exception and show the best legal path.
          </p>
          <button className="button" onClick={() => onScenario("sick")}>
            Analyze a sick call
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      <div className="queue-bottom">
        <span className="live-dot" /> Operational snapshot loaded
      </div>
    </aside>
  );
}
