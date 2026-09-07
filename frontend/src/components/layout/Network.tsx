import { ArrowRight } from "lucide-react";
export function Network({
  closed,
  onClosure,
}: {
  closed: boolean;
  onClosure: () => void;
}) {
  const stations = [
    { id: "DEL", x: 230, y: 38 },
    { id: "BOM", x: 82, y: 135 },
    { id: "HYD", x: 324, y: 131 },
    { id: "CCU", x: 442, y: 92 },
    { id: "GOI", x: 70, y: 241 },
    { id: "MAA", x: 382, y: 266 },
    { id: "COK", x: 173, y: 323 },
  ];
  return (
    <>
      <div className="network-diagram">
        <svg
          viewBox="0 0 520 365"
          role="img"
          aria-label={`Schematic network from BLR to seven stations${closed ? ", HYD affected by closure" : ""}`}
        >
          <defs>
            <pattern
              id="network-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="0.7" fill="#26334a" />
            </pattern>
          </defs>
          <rect width="520" height="365" fill="url(#network-grid)" />
          {stations.map((station) => (
            <g key={station.id}>
              <line
                x1="240"
                y1="220"
                x2={station.x}
                y2={station.y}
                className={
                  station.id === "HYD" && closed ? "affected-route" : ""
                }
              />
              <circle
                cx={station.x}
                cy={station.y}
                r="6"
                className={station.id === "HYD" && closed ? "closed-node" : ""}
              />
              <text x={station.x + 13} y={station.y + 5}>
                {station.id}
              </text>
            </g>
          ))}
          <circle cx="240" cy="220" r="25" className="hub-ring" />
          <circle cx="240" cy="220" r="9" className="hub-node" />
          <text x="258" y="224" className="hub-text">
            BLR
          </text>
          <text x="224" y="266" className="hub-label">
            HUB
          </text>
          {closed && (
            <text x="338" y="153" className="closed-text">
              CLOSED 05:00–09:00
            </text>
          )}
        </svg>
      </div>
      <div className="spread">
        <span className="muted">
          Schematic only · no geographic routing model
        </span>
        <button className="text-link" onClick={onClosure}>
          Explore HYD closure
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
