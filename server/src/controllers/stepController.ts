import { Request, Response } from "express";
import { Project } from "../models/Project";
import {
  listSteps, createStep, updateStep, reorderSteps, deleteStep,
} from "../services/stepService";

async function resolveOwnedProject(req: Request) {
  const user = (req as any).user;
  const project = await Project.findOne({ slug: req.params.slug, projectNumber: Number(req.params.projectNumber) });
  if (!project) return { error: { status: 404, code: "PROJECT_NOT_FOUND" } };
  if (String(project.authorId) !== String(user._id) && !["admin", "ceo", "moderator"].includes(user.role)) {
    return { error: { status: 403, code: "FORBIDDEN" } };
  }
  return { project };
}

export async function getSteps(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  const steps = await listSteps(String(project!._id));
  return res.json({ success: true, data: { steps } });
}

export async function postStep(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  const step = await createStep(String(project!._id), req.body);
  return res.status(201).json({ success: true, data: { step } });
}

export async function patchStep(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  const step = await updateStep(req.params.stepId, req.body);
  if (!step) return res.status(404).json({ success: false, error: { code: "STEP_NOT_FOUND" } });
  return res.json({ success: true, data: { step } });
}

export async function reorder(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  await reorderSteps(String(project!._id), req.body.orderedIds ?? []);
  return res.json({ success: true, data: {} });
}

export async function removeStep(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  await deleteStep(String(project!._id), req.params.stepId);
  return res.json({ success: true, data: {} });
}
