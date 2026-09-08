import { useState } from "react";
import { Plane, Bell, X, ChevronRight, Monitor } from "lucide-react";
import { reviewItems } from "../../data/mocks";
import type { Workspace, ScenarioId } from "../../types/operations";
import { Badge } from "../ui";
export function TopBar({
  go,
  compact,
  setCompact,
  setModal,
  onScenario,
}: {
  go: (workspace: Workspace) => void;
  compact: boolean;
  setCompact: (compact: boolean) => void;
  setModal: (modal: "settings" | "network" | "profile" | "help") => void;
  onScenario: (id: ScenarioId) => void;
}) {
  const [notifications, setNotifications] = useState(false);
  return (
    <header className="global-header">
      <button
        className="brand"
        onClick={() => go("Dashboard")}
        aria-label="home"
      >
        <Plane size={25} />
        <span>
          <span className="brand-cortex">CrewOps Recovery Copilot</span>
        </span>
      </button>
      <div className="product-divider" />
      <span className="product-name">CREW OPERATIONS</span>
      <Badge tone="blue">ADVISOR</Badge>
      <div className="header-right">
        <div className="data-health">
          <span className="live-dot" />
          <span>Operational data loaded</span>
          <small>Synthetic snapshot</small>
        </div>
        <div className="notifications-wrap">
          <button
            className={`icon-button notification-button ${notifications ? "selected" : ""}`}
            aria-label="Notifications"
            aria-expanded={notifications}
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={17} />
            <i />
          </button>
          {notifications && (
            <div className="notification-popover">
              <div className="spread">
                <strong>Operational notifications</strong>
                <button
                  className="icon-button"
                  aria-label="Close notifications"
                  onClick={() => setNotifications(false)}
                >
                  <X size={13} />
                </button>
              </div>
              {reviewItems.map((item) => (
                <button
                  key={item.flight}
                  onClick={() => {
                    setNotifications(false);
                    onScenario(item.scenario);
                  }}
                >
                  <span className="dot warning" />
                  <span>
                    <strong>
                      {item.flight} · {item.role}
                    </strong>
                    <small>{item.date} · Awaiting review</small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="language-select">
          <span className="sr-only">Language</span>
          <select aria-label="Language" disabled title="English interface">
            <option>EN</option>
          </select>
        </label>
        <button
          className="icon-button"
          title="Toggle compact display"
          aria-label="Toggle compact display"
          aria-pressed={compact}
          onClick={() => setCompact(!compact)}
        >
          <Monitor size={16} />
        </button>
        <button
          className="top-avatar"
          aria-label="Open operator profile"
          onClick={() => setModal("profile")}
        >
          AK
        </button>
      </div>
    </header>
  );
}
