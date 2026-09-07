import {
  Check,
  ChevronRight,
  CircleAlert,
  Minus,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { CostComponent, RuleCheck } from "../types/operations";

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function PanelTitle({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      <div className="inline">{children}</div>
    </div>
  );
}
export function FlightChips({ flights }: { flights: string[] }) {
  return (
    <div className="flight-chips">
      {flights.map((id) => (
        <span key={id}>{id}</span>
      ))}
    </div>
  );
}
export function LegalityCheck({
  check,
  detailed = false,
}: {
  check: RuleCheck;
  detailed?: boolean;
}) {
  const Icon =
    check.status === "legal"
      ? Check
      : check.status === "rejected"
        ? X
        : check.status === "warning"
          ? CircleAlert
          : Minus;
  return (
    <div className={`rule-check ${check.status}`}>
      <Icon size={14} />
      <div>
        <div className="inline">
          <strong>{detailed ? check.id : check.label}</strong>
          {detailed && (
            <Badge tone={check.status}>
              {check.status === "legal"
                ? "PASS"
                : check.status === "rejected"
                  ? "FAIL"
                  : check.status.toUpperCase()}
            </Badge>
          )}
        </div>
        {detailed && <p>{check.label}</p>}
        {detailed && check.actual && (
          <div className="rule-values">
            <span>
              Actual <b>{check.actual}</b>
            </span>
            {check.limit && (
              <span>
                Limit <b>{check.limit}</b>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export function CostBreakdown({
  components,
  total,
}: {
  components: CostComponent[];
  total: string;
}) {
  return (
    <div className="cost-breakdown">
      {components.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
      <div className="cost-total">
        <strong>Total</strong>
        <strong>{total}</strong>
      </div>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  drawer = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={drawer ? "drawer" : "modal"}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-content">
        <header className="dialog-header">
          <div>
            <div className="eyebrow">
              <ShieldCheck size={13} /> CREWOPS WORKSPACE
            </div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ChevronRight size={14} />
    </button>
  );
}
