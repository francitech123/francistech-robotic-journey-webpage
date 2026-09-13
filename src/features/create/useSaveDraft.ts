import { useCallback, useState } from "react";

export function useSaveDraft(projectId: string) {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("SAVE_FAILED");
        setLastSavedAt(new Date());
      } finally {
        setSaving(false);
      }
    },
    [projectId]
  );

  return { save, saving, lastSavedAt };
}
