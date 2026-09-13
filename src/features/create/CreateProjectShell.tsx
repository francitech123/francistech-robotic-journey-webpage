import { useState } from "react";
import { useSaveDraft } from "./useSaveDraft";

const STEPS = [
  "Basic Information",
  "Cover & Media",
  "Components",
  "Build Steps",
  "Code",
  "Files",
  "Gallery",
  "Problems & Lessons",
  "YouTube",
  "Preview",
  "Publish",
] as const;

export default function CreateProjectShell({ projectId }: { projectId: string }) {
  const [step, setStep] = useState(0);
  const { save, saving, lastSavedAt } = useSaveDraft(projectId);

  return (
    <div className="create-project">
      <nav className="create-project__progress" aria-label="Project steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={`step-chip ${i === step ? "step-chip--active" : ""}`}
            onClick={() => setStep(i)}
            type="button"
          >
            <span className="step-chip__num">{String(i + 1).padStart(2, "0")}</span>
            <span className="step-chip__label">{label}</span>
          </button>
        ))}
      </nav>

      <section className="create-project__body">
        <h2>{STEPS[step]}</h2>
        {/* Step-specific form components render here per step index. */}
      </section>

      <footer className="create-project__footer">
        <button
          className="btn btn-secondary"
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={saving}
          onClick={() => save({})}
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
        >
          Next
        </button>
        {lastSavedAt && (
          <span className="create-project__saved">
            Last saved {lastSavedAt.toLocaleTimeString()}
          </span>
        )}
      </footer>
    </div>
  );
}
