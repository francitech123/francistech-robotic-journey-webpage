import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireCreator } from "../middleware/requireCreator";
import {
  getSteps, postStep, patchStep, reorder, removeStep,
} from "../controllers/stepController";

export const stepRouter = Router({ mergeParams: true });

stepRouter.get("/projects/:projectNumber/:slug/steps", requireAuth, getSteps);
stepRouter.post("/projects/:projectNumber/:slug/steps", requireAuth, requireCreator, postStep);
stepRouter.patch("/projects/:projectNumber/:slug/steps/reorder", requireAuth, requireCreator, reorder);
stepRouter.patch("/projects/:projectNumber/:slug/steps/:stepId", requireAuth, requireCreator, patchStep);
stepRouter.delete("/projects/:projectNumber/:slug/steps/:stepId", requireAuth, requireCreator, removeStep);
