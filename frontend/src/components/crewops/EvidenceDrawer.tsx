import { FileCheck2, Fingerprint, ShieldCheck } from "lucide-react";
import type { RecoveryOption, Scenario } from "../../types/operations";
import { Badge, CostBreakdown, FlightChips, LegalityCheck, Modal } from "../ui";

export function EvidenceDrawer({
  option,
  scenario,
  onClose,
}: {
  option: RecoveryOption;
  scenario: Scenario;
  onClose: () => void;
}) {
  return (
    <Modal
      drawer
      title="Decision Evidence"
      subtitle={`${option.id} → ${scenario.pairing}`}
      onClose={onClose}
    >
      <div className="evidence-body">
        <div className="evidence-banner">
          <Fingerprint size={16} />
          <div>
            <strong>Traceable by design</strong>
            <span>Deterministic API evidence · read-only</span>
          </div>
          <Badge tone="legal">VERIFIED</Badge>
        </div>

        <section>
          <h3 className="eyebrow">WHY THIS OPTION</h3>
          <p className="evidence-reason">{option.reason}</p>
        </section>
        <section>
          <h3 className="eyebrow">
            <ShieldCheck size={13} /> RULE CHECKS
          </h3>
          <div className="evidence-rules">
            {option.checks.map((check, checkIndex) => (
              <LegalityCheck key={`${check.id}-${checkIndex}`} check={check} detailed />
            ))}
          </div>
        </section>
        <section>
          <h3 className="eyebrow">
            COST CALCULATION <span>INR</span>
          </h3>
          <CostBreakdown components={option.components} total={option.cost} />
        </section>
        <section>
          <h3 className="eyebrow">AFFECTED OPERATION</h3>
          <div className="evidence-pairing">
            <FileCheck2 size={16} />
            <strong className="mono">{scenario.pairing}</strong>
            <Badge tone="blue">{scenario.label}</Badge>
          </div>
          <FlightChips flights={scenario.flights} />
        </section>
        {scenario.evidence && scenario.evidence.length > 0 && (
          <section>
            <h3 className="eyebrow">DETERMINISTIC ANALYSIS EVIDENCE</h3>
            <div className="evidence-rules">
              {scenario.evidence.map((item, index) => (
                <div className="boundary-note" key={`${item.ruleId ?? item.reason}-${index}`}>
                  <FileCheck2 size={14} />
                  <span>{item.ruleId ? `${item.ruleId} · ` : ""}{item.reason}{item.timestamps ? ` · ${Object.values(item.timestamps).join(" / ")}` : ""}{item.details ? ` · ${Object.entries(item.details).map(([key, value]) => `${key}: ${value}`).join(" / ")}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {scenario.agent && (
          <section className="agent-trace">
            <h3 className="eyebrow">AGENT TRACE</h3>
            <p className="evidence-reason">Planner / parser → {scenario.id.toUpperCase()} · Analysis → deterministic CrewOps engine · Explanation → {scenario.agent.explainerUsed ? "AI grounded in deterministic evidence" : "deterministic summary"}</p>
          <p className="muted">Planner: {scenario.agent.plannerMs ?? "—"} ms · Engine: {scenario.agent.toolMs ?? "—"} ms · Explainer: {scenario.agent.explainerMs ?? "—"} ms</p>
          </section>
        )}
        <div className="evidence-footnote">
          <ShieldCheck size={16} />
          <p>
            Legality, timing and cost values are produced by the deterministic
            CrewOps rules engine.
            <br />
            <strong>This result was returned by the deterministic CrewOps API.</strong>
          </p>
        </div>
      </div>
    </Modal>
  );
}
