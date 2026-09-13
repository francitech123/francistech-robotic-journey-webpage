import { Request, Response } from "express";
import { getPublicProject } from "../services/projectService";

export async function getProject(req: Request, res: Response) {
  const projectNumber = Number(req.params.projectNumber);
  const { slug } = req.params;
  const data = await getPublicProject(projectNumber, slug);
  if (!data) {
    return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
  }
  return res.json({ success: true, data });
}
