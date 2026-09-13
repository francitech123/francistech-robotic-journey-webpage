import { Project } from "../models/Project";
import { ProjectStep } from "../models/ProjectStep";
import { Component } from "../models/Component";
import { ProjectFile } from "../models/ProjectFile";

export async function getPublicProject(projectNumber: number, slug: string) {
  const project = await Project.findOne({
    projectNumber,
    slug,
    visibility: "public",
  }).lean();
  if (!project) return null;

  const [steps, components, files] = await Promise.all([
    ProjectStep.find({ projectId: project._id }).sort({ stepNumber: 1 }).lean(),
    Component.find({ projectId: project._id }).lean(),
    ProjectFile.find({ projectId: project._id, status: "ready" })
      .select("-storageKey -bucket -storageProvider")
      .lean(),
  ]);

  return { project, steps, components, files };
}
