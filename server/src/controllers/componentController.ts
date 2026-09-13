import { Request, Response } from "express";
import { Project } from "../models/Project";
import {
  listComponents, addComponent, updateComponent, deleteComponent, computeEstimatedCost,
} from "../services/componentService";

async function resolveOwnedProject(req: Request) {
  const user = (req as any).user;
  const project = await Project.findOne({
    slug: req.params.slug,
    projectNumber: Number(req.params.projectNumber),
  });
  if (!project) return { error: { status: 404, code: "PROJECT_NOT_FOUND" } };
  const isOwner = String(project.authorId) === String(user._id);
  const isStaff = ["moderator", "admin", "ceo"].includes(user.role);
  if (!isOwner && !isStaff) return { error: { status: 403, code: "FORBIDDEN" } };
  return { project };
}

export async function getComponents(req: Request, res: Response) {
  const project = await Project.findOne({
    slug: req.params.slug,
    projectNumber: Number(req.params.projectNumber),
    visibility: "public",
  }).lean();
  if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
  const components = await listComponents(String(project._id));
  const estimatedTotal = computeEstimatedCost(components as any);
  return res.json({ success: true, data: { components, estimatedTotal, currency: project.currency ?? "USD" } });
}

export async function postComponent(req: Request, res: Response) {
  const { project, error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  const component = await addComponent(String(project!._id), req.body);
  return res.status(201).json({ success: true, data: { component } });
}

export async function patchComponent(req: Request, res: Response) {
  const { error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  const component = await updateComponent(req.params.componentId, req.body);
  if (!component) return res.status(404).json({ success: false, error: { code: "COMPONENT_NOT_FOUND" } });
  return res.json({ success: true, data: { component } });
}

export async function removeComponent(req: Request, res: Response) {
  const { error } = await resolveOwnedProject(req);
  if (error) return res.status(error.status).json({ success: false, error: { code: error.code } });
  await deleteComponent(req.params.componentId);
  return res.json({ success: true, data: {} });
}
