import { useState } from "react";

type Step = {
  _id: string;
  stepNumber: number;
  title: string;
  description?: string;
  notes?: string;
  warnings?: string;
  images: string[];
  videos: string[];
  files: string[];
};

export default function BuildStepEditor({
  projectNumber,
  slug,
  initialSteps,
}: {
  projectNumber: number;
  slug: string;
  initialSteps: Step[];
}) {
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [saving, setSaving] = useState(false);

  const base = `/api/projects/${projectNumber}/${slug}/steps`;

  async function addStep() {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: "New step" }),
    });
    const json = await res.json();
    if (json?.data?.step) setSteps((s) => [...s, json.data.step]);
  }

  async function saveStep(step: Step, patch: Partial<Step>) {
    setSaving(true);
    try {
      await fetch(`${base}/${step._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      setSteps((prev) => prev.map((s) => (s._id === step._id ? { ...s, ...patch } : s)));
    } finally {
      setSaving(false);
    }
  }

  async function removeStep(step: Step) {
    await fetch(`${base}/${step._id}`, { method: "DELETE", credentials: "include" });
    setSteps((prev) =>
      prev.filter((s) => s._id !== step._id).map((s, i) => ({ ...s, stepNumber: i + 1 }))
    );
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next.map((s, i) => ({ ...s, stepNumber: i + 1 })));
    await fetch(`${base}/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orderedIds: next.map((s) => s._id) }),
    });
  }

  return (
    <div className="build-step-editor">
      {steps.map((step, i) => (
        <div key={step._id} className="build-step-editor__row">
          <div className="build-step-editor__handle">
            <button type="button" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          </div>
          <span className="build-step-editor__num">
            STEP {String(step.stepNumber).padStart(2, "0")}
          </span>
          <input
            className="input"
            value={step.title}
            onChange={(e) =>
              setSteps((prev) => prev.map((s) => (s._id === step._id ? { ...s, title: e.target.value } : s)))
            }
            onBlur={() => saveStep(step, { title: step.title })}
          />
          <button type="button" className="btn btn-danger btn--sm" onClick={() => removeStep(step)}>
            Delete
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={addStep} disabled={saving}>
        Add step
      </button>
    </div>
  );
}
