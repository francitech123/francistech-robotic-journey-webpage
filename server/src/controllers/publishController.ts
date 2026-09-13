import { Request, Response } from "express";
import mongoose from "mongoose";
import { Project } from "../models/Project";
import { allocateProjectNumber } from "../services/projectNumberService";
import { generateUniqueSlug } from "../utils/slugify";

/**
 * POST /api/projects/:id/publish
 *
 * Required fields are validated here (Tech Spec §31).
 * Project number + slug are allocated inside the same transaction.
 * Number allocation is atomic via Counter.findOneAndUpdate($inc).
 * Slug suffix uses -a1b2c3 short random (Q3 = B).
 *
 * Drafts do not consume a number until this succeeds (V10 §10).
 */
export async function publishProject(req: Request, res: Response) {
  const user = (req as any).user;

  const session = await mongoose.startSession();
  try {
    let published: any = null;

    await session.withTransaction(async () => {
      const project = await Project.findById(req.params.id).session(session);
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      if (String(project.authorId) !== String(user._id)) throw new Error("FORBIDDEN");
      if (project.visibility === "public") throw new Error("ALREADY_PUBLISHED");

      // --- Server-side validation (Tech Spec §31) ---
      const missing: string[] = [];
      if (!project.title?.trim()) missing.push("title");
      if (!project.description?.trim()) missing.push("description");
      if (!project.categoryId) missing.push("categoryId");
      if (missing.length) throw new Error(`VALIDATION_ERROR:${missing.join(",")}`);

      // --- Allocate project number (atomic) ---
      const projectNumber = await allocateProjectNumber();

      // --- Generate slug, retrying on collision with -a1b2c3 suffix ---
      const slug = await generateUniqueSlug(project.title, async (candidate) => {
        const exists = await Project.exists({ slug: candidate }).session(session);
        return !!exists;
      });

      project.projectNumber = projectNumber;
      project.slug = slug;
      project.visibility = "public";
      project.publishedAt = new Date();
      project.searchText = `${project.title} ${project.shortDescription ?? ""}`.toLowerCase();
      await project.save({ session });

      published = project;
    });

    return res.json({ success: true, data: { project: published } });
  } catch (err: any) {
    const msg = String(err?.message ?? "INTERNAL_ERROR");
    const [code, detail] = msg.split(":");
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "ALREADY_PUBLISHED" ? 409 :
      code === "VALIDATION_ERROR" ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: { code, message: detail ?? msg },
    });
  } finally {
    await session.endSession();
  }
}
