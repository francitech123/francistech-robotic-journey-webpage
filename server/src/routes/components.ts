import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireCreator } from "../middleware/requireCreator";
import {
  getComponents, postComponent, patchComponent, removeComponent,
} from "../controllers/componentController";

export const componentRouter = Router({ mergeParams: true });

componentRouter.get("/projects/:projectNumber/:slug/components", getComponents);
componentRouter.post("/projects/:projectNumber/:slug/components", requireAuth, requireCreator, postComponent);
componentRouter.patch("/projects/:projectNumber/:slug/components/:componentId", requireAuth, requireCreator, patchComponent);
componentRouter.delete("/projects/:projectNumber/:slug/components/:componentId", requireAuth, requireCreator, removeComponent);
