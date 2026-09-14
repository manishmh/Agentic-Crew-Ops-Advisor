import {
  ArrowRight,
  Check,
  CircleAlert,
  GitMerge,
  Layers3,
  Plane,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type {
  RecoveryOption as RecoveryOptionData,
  Scenario,
} from "../../types/operations";
import { Badge, FlightChips, LegalityCheck, PanelTitle } from "../ui";
import { RecoveryOption } from "./RecoveryOption";
import { CompactMarkdown } from "./CompactMarkdown";

export function ScenarioResult({
  scenario,
  onEvidence,
}: {
  scenario: Scenario;
  onEvidence: (option: RecoveryOptionData, scenario: Scenario) => void;
}) {
  const [showAllAlternatives, setShowAllAlternatives] = useState(false);
  const legalAlternatives = scenario.alternatives.filter((option) => option.status === "legal").slice(0, 5);
  const rejectedAlternatives = scenario.alternatives.filter((option) => option.status !== "legal").slice(0, 3);
  const conciseAlternatives = [...legalAlternatives, ...rejectedAlternatives];
  const displayedAlternatives = showAllAlternatives ? scenario.alternatives : conciseAlternatives;
  return (
    <div className="scenario-result" data-testid={`scenario-result-${scenario.id}`} data-tour="result">
      <div className="analysis-trail">
        <span>
          <Check size={11} />
          Impact resolved
        </span>
        <ArrowRight size={11} />
        <span>
          <Check size={11} />
          Rules evaluated
        </span>
        <ArrowRight size={11} />
        <span>
          <Check size={11} />
          {scenario.id === "limits" ? "Evidence ready" : "Recovery assessed"}
        </span>
        <Badge tone="success">LIVE DETERMINISTIC RESULT</Badge>
      </div>
      {scenario.naturalLanguageAnswer && scenario.agent?.explainerUsed
        ? <CompactMarkdown source={scenario.naturalLanguageAnswer} />
        : <p className="analysis-summary">{scenario.naturalLanguageAnswer ?? scenario.summary}</p>}
      {scenario.agent && (
        <Badge tone={scenario.agent.plannerFallback ? "muted" : "blue"}>
          {scenario.agent.plannerFallback ? "DETERMINISTIC FALLBACK" : "AI PLANNED · DETERMINISTIC VALIDATION"}
        </Badge>
      )}
      <section className="panel impact-panel">
        <PanelTitle title="Operational Impact">
          <Badge tone={scenario.id === "multi" ? "success" : "warning"}>
            {scenario.status}
          </Badge>
        </PanelTitle>
        <div className="impact-metrics">
          {scenario.metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
        {scenario.flights.length > 0 && (
          <div className="impact-flights">
            <span className="muted">
              <Plane size={12} />
              Affected flights
            </span>
            <FlightChips flights={scenario.flights} />
          </div>
        )}
      </section>
      {scenario.consequence && (
        <section className="panel consequence">
          <PanelTitle title={scenario.consequence.title}>
            <CircleAlert size={15} className="text-warning" />
          </PanelTitle>
          {scenario.consequence.checks.map((check, checkIndex) => (
            <LegalityCheck key={`${check.id}-${checkIndex}`} check={check} detailed />
          ))}
          <div className="boundary-note">
            <Layers3 size={14} />
            {scenario.consequence.note}
          </div>
        </section>
      )}
      {scenario.certificationDuties && (
        <section className="panel">
          <PanelTitle title="Inspected certification duties">
            <Badge tone="purple">DOMAIN DATES · UTC</Badge>
          </PanelTitle>
          <div className="table-scroll">
            <table>
              <thead><tr><th>DUTY DATE</th><th>PAIRING</th><th>FLIGHTS</th><th>AIRCRAFT</th><th>CERTIFICATION</th></tr></thead>
              <tbody>
                {scenario.certificationDuties.map((duty) => (
                  <tr key={`${duty.pairingId}-${duty.dutyDate}`}>
                    <td className="mono">{duty.dutyDate}</td><td className="mono text-bright">{duty.pairingId}</td><td><FlightChips flights={duty.flightIds} /></td><td>{duty.aircraftTypes.join(", ")}</td>
                    <td><Badge tone={duty.certificationLegal ? "legal" : "warning"}>{duty.certificationLegal ? "CERT VALID" : `CERT EXPIRED${duty.expired.length ? ` · ${duty.expired.join(", ")}` : ""}`}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {scenario.affectedFlights && (
        <section className="panel">
          <PanelTitle title="Affected station interactions">
            <Badge tone="purple">[START, END) · UTC</Badge>
          </PanelTitle>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "FLIGHT",
                    "ORIGIN",
                    "DESTINATION",
                    "DEP / ARR · UTC",
                    "REASON",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenario.affectedFlights.map((flight) => (
                  <tr key={flight.id}>
                    <td className="mono text-bright">{flight.id}</td>
                    <td>{flight.origin}</td>
                    <td>{flight.destination}</td>
                    <td className="mono">
                      {flight.departure} / {flight.arrival}
                    </td>
                    <td>
                      <Badge tone="warning">{flight.reason}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="closure-outcome">
            <div>
              <span>Cancellation fallback</span>
              <strong>{scenario.closureOutcome?.fallbackCost ?? "Not required"}</strong>
            </div>
            <Badge tone={scenario.closureOutcome?.recoveryRequired ? "warning" : "legal"}>
              {scenario.closureOutcome?.recoveryRequired ? scenario.closureOutcome.recoveryAvailable === false ? "FALLBACK REQUIRED" : "RECOVERY REQUIRED" : "NO RECOVERY REQUIRED"}
            </Badge>
          </div>
          {scenario.closureOutcome?.consequence && <div className="boundary-note"><Layers3 size={14} />{scenario.closureOutcome.consequence}</div>}
        </section>
      )}
      {scenario.joint && (
        <section className="recovery-card joint-plan">
          <div className="recovery-header">
            <span>
              <GitMerge size={16} />
              JOINT RECOVERY PLAN
            </span>
            <Badge tone="success">COMPLETE PLAN</Badge>
          </div>
          {scenario.joint.map((item) => (
            <div className="joint-row" key={item.pairing}>
              <span className="mono">{item.pairing}</span>
              <ArrowRight size={16} />
              <div>
                <strong>{item.crew}</strong>
                <small>{item.unavailableCrew ? `${item.unavailableCrew} unavailable · ` : ""}{item.method}</small>
              </div>
              <Badge tone={item.status === "legal" ? "legal" : item.status === "rejected" ? "warning" : "muted"}>
                {item.status === "legal" ? <Check size={10} /> : null}
                {item.status === "legal" ? "LEGAL" : item.status === "rejected" ? "UNRESOLVED" : "CANCELLATION"}
              </Badge>
              <strong className="mono">{item.cost}{item.delay ? ` · ${item.delay}` : ""}</strong>
            </div>
          ))}
          <div className="joint-total">
            <span>
              <ShieldCheck size={15} />
              No conflicting crew assignments
            </span>
            <div>
              <span>Joint total</span>
              <strong>{scenario.total}</strong>
            </div>
          </div>
        </section>
      )}
      {scenario.recommended && (
        <RecoveryOption
          option={scenario.recommended}
          recommended
          onEvidence={(option) => onEvidence(option, scenario)}
        />
      )}
      {scenario.alternatives.length > 0 && (
        <section className="alternatives">
          <div className="spread">
            <h2>
              Recovery candidates{" "}
              <span className="count-chip">{displayedAlternatives.length} / {scenario.alternatives.length}</span>
            </h2>
            <span className="muted">Top 5 ranked legal · 3 representative rejections</span>
          </div>
          {displayedAlternatives.map((option, optionIndex) => (
            <RecoveryOption
              key={`${option.id}-${optionIndex}`}
              option={option}
              onEvidence={(selected) => onEvidence(selected, scenario)}
            />
          ))}
          {scenario.alternatives.length > conciseAlternatives.length && (
            <button
              type="button"
              className="text-link alternatives-toggle"
              onClick={() => setShowAllAlternatives((current) => !current)}
            >
              {showAllAlternatives ? "Show concise candidate list" : `View all ${scenario.alternatives.length} candidates`}
              <ArrowRight size={13} />
            </button>
          )}
        </section>
      )}
      {scenario.note && (
        <div className="model-note">
          <CircleAlert size={14} />
          <span>{scenario.note}</span>
        </div>
      )}
      {(scenario.id === "closure" || scenario.id === "certification" || scenario.id === "multi") && scenario.evidence && (
        <button
          type="button"
          className="text-link"
          data-testid="deterministic-evidence-button"
          data-tour="decision-evidence"
          onClick={() => onEvidence({ id: scenario.id === "closure" ? "STATION_CLOSURE" : scenario.id === "certification" ? "CERT_EXPIRY" : "MULTI_SICK", name: `${scenario.label} assessment`, role: "Deterministic evidence", method: "Read-only analysis", status: "not-evaluated", cost: "—", delay: "—", positioning: "—", reason: "Deterministic timing, rule, recovery, and cost evidence.", checks: [], components: [] }, scenario)}
        >
          View deterministic evidence
        </button>
      )}
      <div className="analysis-signoff">
        <ShieldCheck size={12} />
        Structured evidence available · No operational changes applied
      </div>
    </div>
  );
}
