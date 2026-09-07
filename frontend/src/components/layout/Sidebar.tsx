import { useState } from "react";
import {
  LayoutDashboard,
  Plane,
  GitBranch,
  Sparkles,
  Menu,
  CircleHelp,
  Settings,
} from "lucide-react";
const rail = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Operations", icon: Plane },
  { label: "Recovery / Exceptions", icon: GitBranch },
  { label: "CrewOps AI", icon: Sparkles },
];
export function Sidebar({
  railActive,
  railClick,
  setModal,
}: {
  railActive: string;
  railClick: (label: string) => void;
  setModal: (modal: "settings" | "network" | "profile" | "help") => void;
}) {
  const [expandedRail, setExpandedRail] = useState(false);
  return (
    <nav
      className={`nav-rail ${expandedRail ? "expanded" : ""}`}
      aria-label="Global navigation"
    >
      <button
        className="rail-menu"
        aria-label="Toggle navigation labels"
        aria-expanded={expandedRail}
        onClick={() => setExpandedRail(!expandedRail)}
      >
        <Menu size={20} />
      </button>
      <div className="rail-section">
        <span className="rail-section-label">WORKSPACE</span>
        {rail.map((item) => (
          <button
            key={item.label}
            title={item.label}
            aria-label={item.label}
            aria-current={railActive === item.label ? "page" : undefined}
            className={railActive === item.label ? "active" : ""}
            onClick={() => railClick(item.label)}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
            {item.label === "Recovery / Exceptions" && (
              <i className="rail-alert" />
            )}
          </button>
        ))}
      </div>
      <div className="rail-bottom">
        <button title="Help" aria-label="Help" onClick={() => setModal("help")}>
          <CircleHelp size={18} />
          <span>Help</span>
        </button>
        <button
          title="Settings"
          aria-label="Settings"
          onClick={() => setModal("settings")}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <div className="rail-divider" />
        <button
          className="rail-avatar"
          aria-label="Operator profile"
          onClick={() => setModal("profile")}
        >
          AK
        </button>
      </div>
    </nav>
  );
}
