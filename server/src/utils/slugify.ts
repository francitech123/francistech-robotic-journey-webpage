import crypto from "crypto";

function base(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function slugify(title: string): string {
  return base(title);
}

/**
 * Safe unique suffix per Tech Spec §78.
 * Format: -a1b2c3 (short random hex).
 */
export function slugifyWithSuffix(title: string): string {
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `${base(title)}-${suffix}`;
}

/**
 * Generate a collision-safe slug. Assumes the caller has already checked
 * the DB for an existing slug and calls this only on collision.
 */
export async function generateUniqueSlug(
  title: string,
  exists: (slug: string) => Promise<boolean>
): Promise<string> {
  const first = slugify(title);
  if (!(await exists(first))) return first;
  // Loop is safe: random 24-bit space; extremely unlikely to collide twice.
  for (let i = 0; i < 5; i++) {
    const candidate = slugifyWithSuffix(title);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("SLUG_GENERATION_FAILED");
}
