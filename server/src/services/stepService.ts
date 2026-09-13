import mongoose from "mongoose";
import { ProjectStep } from "../models/ProjectStep";

export async function listSteps(projectId: string) {
  return ProjectStep.find({ projectId }).sort({ stepNumber: 1 }).lean();
}

export async function createStep(projectId: string, input: {
  title: string; description?: string; notes?: string; warnings?: string;
}) {
  const last = await ProjectStep.findOne({ projectId }).sort({ stepNumber: -1 }).lean();
  const next = last ? last.stepNumber + 1 : 1;
  return ProjectStep.create({
    projectId,
    stepNumber: next,
    title: input.title,
    description: input.description ?? "",
    notes: input.notes ?? "",
    warnings: input.warnings ?? "",
    images: [], videos: [], files: [],
  });
}

export async function updateStep(stepId: string, patch: Record<string, unknown>) {
  const allowed = ["title", "description", "notes", "warnings", "images", "videos", "files"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in patch) update[k] = patch[k];
  return ProjectStep.findByIdAndUpdate(stepId, update, { new: true });
}

/**
 * Reorders steps atomically. `orderedIds` is the full new sequence of
 * step _id values for the project. Uses a two-phase write so the unique
 * (projectId, stepNumber) index never sees a duplicate mid-transaction.
 */
export async function reorderSteps(projectId: string, orderedIds: string[]) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Phase 1: shift all to a high temporary range.
      await ProjectStep.updateMany(
        { projectId },
        { $inc: { stepNumber: 100000 } },
        { session }
      );
      // Phase 2: assign final numbers.
      for (let i = 0; i < orderedIds.length; i++) {
        await ProjectStep.updateOne(
          { _id: orderedIds[i], projectId },
          { $set: { stepNumber: i + 1 } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

export async function deleteStep(projectId: string, stepId: string) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const step = await ProjectStep.findOne({ _id: stepId, projectId }).session(session);
      if (!step) throw new Error("STEP_NOT_FOUND");
      await ProjectStep.deleteOne({ _id: stepId }, { session });
      // Compact remaining step numbers.
      await ProjectStep.updateMany(
        { projectId, stepNumber: { $gt: step.stepNumber } },
        { $inc: { stepNumber: -1 } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
}
