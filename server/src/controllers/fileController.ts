import { Request, Response } from "express";
import { Project } from "../models/Project";
import { ProjectFile, FILE_CATEGORIES } from "../models/ProjectFile";
import { buildStorageKey, newFileId, ObjectStorage, safeFilename } from "../storage/objectStorage";

const ALLOWED_MIME_BY_CATEGORY: Record<string, RegExp[]> = {
  cover:      [/^image\/(png|jpeg|webp)$/],
  gallery:    [/^image\/(png|jpeg|webp)$/],
  video:      [/^video\/(mp4|webm)$/],
  code:       [/^application\/(zip|x-zip-compressed)$/, /^text\//, /^application\/json$/],
  cad:        [/^application\/(octet-stream|zip)$/, /^model\//],
  schematic:  [/^application\/pdf$/, /^image\/(png|jpeg)$/],
  document:   [/^application\/pdf$/, /^text\//, /^application\/msword$/],
  other:      [/.*/],
};

const MAX_SIZE_BY_CATEGORY: Record<string, number> = {
  cover: 10 * 1024 * 1024,
  gallery: 15 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  code: 100 * 1024 * 1024,
  cad: 200 * 1024 * 1024,
  schematic: 25 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  other: 200 * 1024 * 1024,
};

function validateUpload(category: string, mimeType: string, size: number): string | null {
  if (!FILE_CATEGORIES.includes(category as any)) return "INVALID_CATEGORY";
  const allowed = ALLOWED_MIME_BY_CATEGORY[category];
  if (!allowed.some((re) => re.test(mimeType))) return "INVALID_FILE_TYPE";
  const max = MAX_SIZE_BY_CATEGORY[category] ?? 50 * 1024 * 1024;
  if (size > max) return "FILE_TOO_LARGE";
  return null;
}

export function makeFileController(storage: ObjectStorage) {
  return {
    /** POST /api/projects/:projectNumber/:slug/files/upload-url */
    async signUpload(req: Request, res: Response) {
      const user = (req as any).user;
      const { category, originalFilename, mimeType, size } = req.body ?? {};
      const project = await Project.findOne({
        slug: req.params.slug,
        projectNumber: Number(req.params.projectNumber),
      });
      if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
      if (String(project.authorId) !== String(user._id)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
      }

      const err = validateUpload(category, mimeType, size);
      if (err) return res.status(400).json({ success: false, error: { code: err } });

      const fileId = newFileId();
      const safe = safeFilename(originalFilename);
      const key = buildStorageKey(project.projectNumber, category, fileId, safe);
      const uploadUrl = await storage.presignPut(key, mimeType, size);

      return res.json({
        success: true,
        data: {
          uploadUrl,
          fileId,
          storageKey: key,   // echoed so the client can send it back; backend re-verifies on complete
        },
      });
    },

    /** POST /api/projects/:projectNumber/:slug/files/complete */
    async completeUpload(req: Request, res: Response) {
      const user = (req as any).user;
      const { fileId, storageKey, originalFilename, mimeType, size, category, downloadable } = req.body ?? {};
      const project = await Project.findOne({
        slug: req.params.slug,
        projectNumber: Number(req.params.projectNumber),
      });
      if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
      if (String(project.authorId) !== String(user._id)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
      }

      // Verify the object actually exists in storage.
      const head = await storage.headObject(storageKey);
      if (!head) return res.status(400).json({ success: false, error: { code: "UPLOAD_FAILED" } });

      const file = await ProjectFile.create({
        projectId: project._id,
        uploadedBy: user._id,
        filename: safeFilename(originalFilename),
        originalFilename,
        storageProvider: process.env.STORAGE_PROVIDER ?? "s3",
        bucket: process.env.STORAGE_BUCKET ?? "idevrx-development",
        storageKey,
        mimeType,
        size: head.size ?? size,
        category,
        status: "ready",
        downloadable: Boolean(downloadable),
        accessPolicy: project.visibility === "public" ? "public" : "creator-only",
      });

      return res.status(201).json({ success: true, data: { file: { ...file.toObject(), storageKey: undefined } } });
    },

    /** GET /api/projects/:projectNumber/:slug/files */
    async list(req: Request, res: Response) {
      const project = await Project.findOne({
        slug: req.params.slug,
        projectNumber: Number(req.params.projectNumber),
        visibility: "public",
      }).lean();
      if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
      const files = await ProjectFile.find({ projectId: project._id, status: "ready" })
        .select("-storageKey -bucket -storageProvider")
        .sort({ createdAt: -1 })
        .lean();
      return res.json({ success: true, data: { files } });
    },

    /**
     * GET /api/files/:fileId/download
     * Per storage architecture doc: verify access, then return a temporary signed URL.
     */
    async download(req: Request, res: Response) {
      const file = await ProjectFile.findById(req.params.fileId).lean();
      if (!file || file.status !== "ready") {
        return res.status(404).json({ success: false, error: { code: "FILE_NOT_FOUND" } });
      }
      const project = await Project.findOne({ _id: file.projectId }).lean();
      if (!project) return res.status(404).json({ success: false, error: { code: "PROJECT_NOT_FOUND" } });

      const user = (req as any).user;
      const isOwner = user && String(project.authorId) === String(user._id);
      const isStaff = user && ["moderator", "admin", "ceo"].includes(user.role);

      if (project.visibility !== "public" && !isOwner && !isStaff) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
      }
      if (!file.downloadable && !isOwner && !isStaff) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
      }

      const url = await storage.presignGet(file.storageKey, 60);
      return res.json({ success: true, data: { url, filename: file.originalFilename, mimeType: file.mimeType, size: file.size } });
    },

    /** DELETE /api/files/:fileId */
    async remove(req: Request, res: Response) {
      const user = (req as any).user;
      const file = await ProjectFile.findById(req.params.fileId);
      if (!file) return res.status(404).json({ success: false, error: { code: "FILE_NOT_FOUND" } });
      if (String(file.uploadedBy) !== String(user._id) && !["admin", "ceo"].includes(user.role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
      }
      await storage.deleteObject(file.storageKey);
      await ProjectFile.deleteOne({ _id: file._id });
      return res.json({ success: true, data: {} });
    },
  };
}
