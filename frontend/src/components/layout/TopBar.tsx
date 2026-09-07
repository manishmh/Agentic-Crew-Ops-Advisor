import { useState } from "react";
import { RefreshCw, Bell, X, ChevronRight, Monitor } from "lucide-react";
import { reviewItems } from "../../data/mocks";
import type { Workspace, ScenarioId } from "../../types/operations";
import { Badge } from "../ui";
export function TopBar({
  go,
  compact,
  setCompact,
  setModal,
  setToast,
  onScenario,
}: {
  go: (workspace: Workspace) => void;
  compact: boolean;
  setCompact: (compact: boolean) => void;
  setModal: (modal: "settings" | "network" | "profile" | "help") => void;
  setToast: (message: string) => void;
  onScenario: (id: ScenarioId) => void;
}) {
  const [notifications, setNotifications] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  return (
    <header className="global-header">
      <button
        className="brand"
        onClick={() => go("Dashboard")}
        aria-label="home"
      >
        <span className="brand-mark">
          <span />
          <span />
          <span />
        </span>
        <span>
          <span className="brand-cortex">CrewOps advisor</span>
          <sup>®</sup>
        </span>
      </button>
      <div className="product-divider" />
      <span className="product-name">CREW OPERATIONS</span>
      <Badge tone="blue">ADVISOR</Badge>
      <div className="header-right">
        <div className="data-health">
          <span className="live-dot" />
          <span>Operational data loaded</span>
          <small>Mock snapshot</small>
        </div>
        <span className="updated-label">
          {refreshed ? "Demo reloaded" : "Updated just now"}
        </span>
        <button
          className="icon-button"
          title="Reload demo snapshot"
          aria-label="Refresh demo snapshot"
          onClick={() => {
            setRefreshed(true);
            setToast(
              "Demo snapshot refreshed. No live operational data is connected.",
            );
          }}
        >
          <RefreshCw size={15} />
        </button>
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
          <select aria-label="Language">
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
