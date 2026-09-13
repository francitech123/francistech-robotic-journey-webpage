import { Component } from "../models/Component";

export async function listComponents(projectId: string) {
  return Component.find({ projectId }).sort({ createdAt: 1 }).lean();
}

export async function addComponent(projectId: string, input: Record<string, unknown>) {
  return Component.create({ ...input, projectId });
}

export async function updateComponent(componentId: string, patch: Record<string, unknown>) {
  const allowed = [
    "name", "description", "quantity", "unit", "category", "partNumber",
    "manufacturer", "estimatedUnitCost", "currency",
    "supplierName", "supplierUrl", "notes",
  ];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in patch) update[k] = patch[k];
  return Component.findByIdAndUpdate(componentId, update, { new: true });
}

export async function deleteComponent(componentId: string) {
  return Component.deleteOne({ _id: componentId });
}

/**
 * Estimated project cost = Σ (quantity × estimatedUnitCost).
 * Per V10 §15. Returns null if no component has a cost.
 */
export function computeEstimatedCost(components: Array<{ quantity: number; estimatedUnitCost?: number }>): number | null {
  let hasAny = false;
  let total = 0;
  for (const c of components) {
    if (typeof c.estimatedUnitCost === "number") {
      hasAny = true;
      total += (c.quantity || 0) * c.estimatedUnitCost;
    }
  }
  return hasAny ? total : null;
}
