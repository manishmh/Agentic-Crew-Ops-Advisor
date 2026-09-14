import { ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onTakeTour: () => void;
  onExplore: () => void;
};

export function CrewOpsWelcome({ open, onTakeTour, onExplore }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="crewops-welcome"
      aria-labelledby="crewops-welcome-title"
      aria-describedby="crewops-welcome-description"
      onCancel={(event) => {
        event.preventDefault();
        onExplore();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onExplore();
      }}
    >
      <div className="welcome-content">
        <header>
          <div className="ai-icon"><Sparkles size={18} /></div>
          <div>
            <span><i className="live-dot" /> RECOVERY WORKSPACE BRIEFING</span>
            <h2 id="crewops-welcome-title">CrewOps Recovery Copilot</h2>
          </div>
          <button className="icon-button" aria-label="Explore without the tour" onClick={onExplore}><X size={17} /></button>
        </header>
        <div className="welcome-body">
          <p id="crewops-welcome-description">An airline operations recovery workspace that analyzes crew and flight disruptions, validates operational constraints, and recommends evidence-backed recovery plans.</p>
          <div className="welcome-principle"><ShieldCheck size={16} /><p><strong>AI interprets the request and explains the result.</strong> Deterministic code decides legality, timing, cost, and recovery.</p></div>
        </div>
        <footer>
          <button className="button" onClick={onExplore}>Explore myself</button>
          <button className="button primary" onClick={onTakeTour}>Take 60-second tour</button>
        </footer>
      </div>
    </dialog>
  );
}
