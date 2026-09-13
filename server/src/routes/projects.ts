import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireCreator } from "../middleware/requireCreator";
import {
  createDraft, listMyDrafts, getDraft, updateDraft, deleteDraft,
} from "../controllers/draftController";
import { publishProject } from "../controllers/publishController";

export const projectRouter = Router();

// All project write routes require authentication + Creator role.
projectRouter.post("/projects", requireAuth, requireCreator, createDraft);
projectRouter.patch("/projects/:id", requireAuth, requireCreator, updateDraft);
projectRouter.delete("/projects/:id", requireAuth, requireCreator, deleteDraft);
projectRouter.post("/projects/:id/publish", requireAuth, requireCreator, publishProject);

// Drafts list is scoped to the authenticated creator.
projectRouter.get("/drafts", requireAuth, requireCreator, listMyDrafts);
projectRouter.get("/projects/:id", requireAuth, getDraft);
