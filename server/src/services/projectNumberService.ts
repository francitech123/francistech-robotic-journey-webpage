import { Counter } from "../models/Counter";

/**
 * Allocates the next permanent project number.
 * Format: PROJECT 001, PROJECT 002, ...
 * Numbers are never recycled (Tech Spec §77).
 * Must only be called inside the publish transaction (V10 §10).
 */
export async function allocateProjectNumber(): Promise<number> {
  const result = await Counter.findOneAndUpdate(
    { _id: "projectNumber" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return result.seq;
}

export function formatProjectNumber(n: number): string {
  return `PROJECT ${String(n).padStart(3, "0")}`;
}
