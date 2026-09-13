import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireCreator } from "../middleware/requireCreator";
import { makeFileController } from "../controllers/fileController";
import { S3ObjectStorage } from "../storage/s3ObjectStorage";

const storage = new S3ObjectStorage();
const controller = makeFileController(storage);

export const fileRouter = Router();

fileRouter.post("/projects/:projectNumber/:slug/files/upload-url", requireAuth, requireCreator, controller.signUpload);
fileRouter.post("/projects/:projectNumber/:slug/files/complete", requireAuth, requireCreator, controller.completeUpload);
fileRouter.get("/projects/:projectNumber/:slug/files", controller.list);
fileRouter.get("/files/:fileId/download", requireAuth, controller.download);
fileRouter.delete("/files/:fileId", requireAuth, requireCreator, controller.remove);
