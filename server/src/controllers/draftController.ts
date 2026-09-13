import { Request, Response } from "express";
import { Project } from "../models/Project";

/** POST /api/projects  — create a draft. Never assigns a project number. */
export async function createDraft(req: Request, res: Response) {
  const user = (req as any).user;
  const { title = "Untitled Project", categoryId, tags = [], difficulty, status = "idea" } = req.body;

  const draft = await Project.create({
    title,
    categoryId,
    tags,
    difficulty,
    status,
    authorId: user._id,
    visibility: "draft",
    projectNumber: 0,
    slug: "",
  });

  return res.status(201).json({ success: true, data: { project: draft } });
}

/** GET /api/drafts — list drafts for the logged-in creator. */
export async function listMyDrafts(req: Request, res: Response) {
  const user = (req as any).user;
  const drafts = await Project.find({ authorId: user._id, visibility: "draft" })
    .sort({ updatedAt: -1 })
    .lean();
  return res.json({ success: true, data: { drafts } });
}

/** GET /api/projects/:id — fetch one draft/owned project. */
export async function getDraft(req: Request, res: Response) {
  const user = (req as any).user;
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
  }
  const isOwner = String(project.authorId) === String(user._id);
  const isStaff = ["moderator", "admin", "ceo"].includes(user.role);
  if (project.visibility === "draft" && !isOwner && !isStaff) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  return res.json({ success: true, data: { project } });
}

/** PATCH /api/projects/:id — update fields. Called on each manual Save Draft. */
export async function updateDraft(req: Request, res: Response) {
  const allowed = [
    "title", "shortDescription", "description", "categoryId", "tags",
    "difficulty", "status", "estimatedCost", "currency", "buildTime",
    "coverImage", "gallery", "youtubeUrl", "youtubeVideoId",
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) if (key in req.body) update[key] = req.body[key];

  const project = await Project.findByIdAndUpdate(req.params.id, update, { new: true });
  return res.json({ success: true, data: { project } });
}

/** DELETE /api/projects/:id — delete a draft the caller owns. */
export async function deleteDraft(req: Request, res: Response) {
  await Project.deleteOne({ _id: req.params.id });
  return res.json({ success: true, data: {} });
}
