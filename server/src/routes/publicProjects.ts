import { Router } from "express";
import { getProject } from "../controllers/publicProjectController";

export const publicProjectRouter = Router();
publicProjectRouter.get("/projects/:projectNumber/:slug", getProject);
