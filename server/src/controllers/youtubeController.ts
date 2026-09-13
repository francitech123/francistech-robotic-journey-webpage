import { Request, Response } from "express";
import { Project } from "../models/Project";
import { extractYouTubeVideoId } from "../utils/youtube";

export async function setYoutube(req: Request, res: Response) {
  const user = (req as any).user;
  const { youtubeUrl } = req.body ?? {};
  const project = await Project.findOne({
    slug: req.params.slug,
    projectNumber: Number(req.params.projectNumber),
  });
  if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
  if (String(project.authorId) !== String(user._id)) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  if (!youtubeUrl) {
    project.youtubeUrl = undefined;
    project.youtubeVideoId = undefined;
    await project.save();
    return res.json({ success: true, data: { project } });
  }
  const videoId = extractYouTubeVideoId(youtubeUrl);
  if (!videoId) return res.status(400).json({ success: false, error: { code: "INVALID_YOUTUBE_URL" } });
  project.youtubeUrl = youtubeUrl;
  project.youtubeVideoId = videoId;
  await project.save();
  return res.json({ success: true, data: { project } });
}
