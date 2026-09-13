import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireCreator } from "../middleware/requireCreator";
import { setYoutube } from "../controllers/youtubeController";

export const youtubeRouter = Router({ mergeParams: true });
youtubeRouter.patch("/projects/:projectNumber/:slug/youtube", requireAuth, requireCreator, setYoutube);
