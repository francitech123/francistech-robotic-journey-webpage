// Pure helpers: CSV export and version comparison.

export const csvCell = (v: unknown): string => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

const SCALARS = [
  "title", "description", "category", "difficulty", "buildTime", "cost", "buildStatus", "controller", "language",
  "sensors", "actuators", "power", "communication", "why", "problems", "nextVersion", "youtubeUrl",
] as const;

type Comp = { name?: string; qty?: number; spec?: string };

export function diffSnapshots(a: any, b: any) {
  const changes = SCALARS.filter((f) => (a?.[f] ?? "") !== (b?.[f] ?? "")).map((f) => ({ field: f, from: a?.[f] ?? "", to: b?.[f] ?? "" }));

  const ta: string[] = a?.tags ?? [];
  const tb: string[] = b?.tags ?? [];
  const tags = { added: tb.filter((t) => !ta.includes(t)), removed: ta.filter((t) => !tb.includes(t)) };

  const key = (c: Comp) => (c.name ?? "").trim().toLowerCase();
  const view = (c: Comp) => ({ name: c.name ?? "", qty: c.qty ?? 1, spec: c.spec ?? "" });
  const ca = new Map<string, Comp>((a?.components ?? []).map((c: Comp) => [key(c), c]));
  const cb = new Map<string, Comp>((b?.components ?? []).map((c: Comp) => [key(c), c]));
  const components = {
    added: [...cb].filter(([k]) => !ca.has(k)).map(([, c]) => view(c)),
    removed: [...ca].filter(([k]) => !cb.has(k)).map(([, c]) => view(c)),
    changed: [...cb]
      .filter(([k, c]) => ca.has(k) && (ca.get(k)!.qty !== c.qty || (ca.get(k)!.spec ?? "") !== (c.spec ?? "")))
      .map(([k, c]) => ({ name: c.name ?? "", from: view(ca.get(k)!), to: view(c) })),
  };

  const sa: string[] = a?.steps ?? [];
  const sb: string[] = b?.steps ?? [];
  const steps = { added: sb.filter((s) => !sa.includes(s)), removed: sa.filter((s) => !sb.includes(s)) };

  const identical =
    !changes.length && !tags.added.length && !tags.removed.length &&
    !components.added.length && !components.removed.length && !components.changed.length &&
    !steps.added.length && !steps.removed.length;
  return { identical, changes, tags, components, steps };
}
