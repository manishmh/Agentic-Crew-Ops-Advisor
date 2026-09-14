import {
  ArrowRight,
  Award,
  ChevronDown,
  FileCheck2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { RecoveryOption as RecoveryOptionData } from "../../types/operations";
import { Badge, CostBreakdown, LegalityCheck } from "../ui";

export function RecoveryOption({
  option,
  recommended = false,
  onEvidence,
}: {
  option: RecoveryOptionData;
  recommended?: boolean;
  onEvidence: (option: RecoveryOptionData) => void;
}) {
  if (!recommended)
    return (
      <details
        className={`alternative-option ${option.status}`}
      >
        <summary>
          <span className="alternative-identity">
            <UserRound size={15} />
            <strong className="mono">{option.id}</strong>
            <Badge tone={option.status}>
              {option.status.replace("-", " ").toUpperCase()}
            </Badge>
          </span>
          <span className="alternative-method">{option.method}</span>
          <strong className="mono">{option.cost}</strong>
          <span className="mono muted">{option.delay}</span>
          <ChevronDown size={14} />
        </summary>
        <div className="alternative-details">
          <div>
            <p>{option.reason}</p>
            {option.checks.map((check, checkIndex) => (
              <LegalityCheck check={check} detailed key={`${check.id}-${checkIndex}`} />
            ))}
            {option.comparison && (
              <div className="comparison">{option.comparison}</div>
            )}
          </div>
          {option.components.length > 0 && (
            <CostBreakdown components={option.components} total={option.cost} />
          )}
        </div>
        {option.status === "legal" && (
          <button
            className="text-link alternative-evidence"
            onClick={() => onEvidence(option)}
          >
            Inspect option evidence
            <ArrowRight size={13} />
          </button>
        )}
      </details>
    );
  return (
    <section className="recovery-card">
      <div className="recovery-header">
        <span>
          <Award size={16} /> RECOMMENDED RECOVERY
        </span>
        <Badge tone="success">BEST OPTION</Badge>
      </div>
      <div className="recovery-main">
        <div className="recovery-identity">
          <div className="crew-avatar">
            <UserRound size={23} />
          </div>
          <div>
            <div className="inline">
              <h3>{option.id}</h3>
              <Badge tone="legal">
                <ShieldCheck size={11} />
                LEGAL
              </Badge>
            </div>
            <p>{option.role}</p>
          </div>
        </div>
        <div className="recovery-metrics">
          <div>
            <strong>{option.cost}</strong>
            <span>{option.costLabel ?? "Total cost"}</span>
          </div>
          <div>
            <strong>{option.delay}</strong>
            <span>Operational delay</span>
          </div>
          <div>
            <strong>{option.positioning}</strong>
            <span>Positioning required</span>
          </div>
        </div>
      </div>
      {option.assignments && option.assignments.length > 0 && (
        <div className="recovery-assignments" aria-label="Selected crew assignments">
          {option.assignments.map((assignment) => (
            <div key={`${assignment.role}-${assignment.id}`}>
              <span>{assignment.role}</span>
              <strong className="mono">{assignment.id}</strong>
              <small>{assignment.name} · {assignment.base} · {assignment.method}</small>
              <b className="mono">{assignment.cost}</b>
            </div>
          ))}
        </div>
      )}
      <div className="recovery-checks">
        {option.checks.map((check, checkIndex) => (
          <LegalityCheck key={`${check.id}-${checkIndex}`} check={check} />
        ))}
      </div>
      <div className="recovery-footer">
        <span>
          <ShieldCheck size={13} />
          {option.reason}
        </span>
        <button className="button primary" data-testid="decision-evidence-button" data-tour="decision-evidence" onClick={() => onEvidence(option)}>
          <FileCheck2 size={14} />
          View Decision Evidence
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
