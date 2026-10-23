import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { Project, ProjectFile } from "../models.js";
import { auth, optionalAuth, requireCreator, parse, HttpError } from "../middleware.js";
import { getBytes, head, remove, signedGet, signedPut } from "../storage.js";

const r = Router();

// Allowlist, not blocklist. Executables, scripts and HTML are never accepted.
const KIND_BY_EXT: Record<string, string> = {
  zip: "archive", pdf: "document", md: "document", txt: "document", csv: "document", json: "document",
  png: "image", jpg: "image", jpeg: "image", svg: "image",
  stl: "cad", step: "cad", stp: "cad", f3d: "cad", dwg: "cad",
  ino: "source", py: "source", cpp: "source", c: "source", h: "source",
  mp4: "video",
};
const COVER_EXT = ["png", "jpg", "jpeg", "webp"]; // no SVG: covers can be served inline
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 50;

const safeName = (n: string) => n.split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

// Step 1: ask for an upload URL. The browser then PUTs the file straight to storage.
r.post("/projects/:id/files/presign", auth, requireCreator, async (req, res) => {
  const d = parse(
    z.object({
      filename: z.string().min(1).max(200),
      size: z.number().int().min(1),
      contentType: z.string().max(100),
      kind: z.enum(["file", "cover"]).default("file"),
    }),
    req.body
  );
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  const project = await Project.findOne({ _id: id, creator: req.user!.id }).select("_id").lean();
  if (!project) throw new HttpError(404, "Not found");

  const name = safeName(d.filename);
  const ext = name.split(".").pop()!.toLowerCase();
  const cover = d.kind === "cover";
  if (cover ? !COVER_EXT.includes(ext) : !KIND_BY_EXT[ext]) throw new HttpError(400, `.${ext} files are not allowed`);
  if (d.size > (cover ? MAX_COVER_BYTES : MAX_BYTES)) throw new HttpError(400, "File is too large");
  if (!cover && (await ProjectFile.countDocuments({ project: id, kind: { $ne: "cover" } })) >= MAX_FILES)
    throw new HttpError(400, `A project can have at most ${MAX_FILES} files`);

  const storageKey = `projects/${id}/${randomUUID()}-${name}`;
  const file = await ProjectFile.create({
    project: id,
    uploader: req.user!.id,
    filename: name,
    size: d.size,
    contentType: d.contentType,
    kind: cover ? "cover" : KIND_BY_EXT[ext],
    storageKey,
  });
  res.status(201).json({
    fileId: file.id,
    uploadUrl: await signedPut(storageKey, d.contentType, d.size),
    headers: { "Content-Type": d.contentType },
  });
});

// Step 2: after the PUT succeeds, confirm. We verify the real object size before accepting it.
r.post("/files/:id/confirm", auth, requireCreator, async (req, res) => {
  const file = await ProjectFile.findOne({ _id: String(req.params.id), uploader: req.user!.id });
  if (!file) throw new HttpError(404, "Not found");
  const obj = await head(file.storageKey);
  if (!obj || obj.size !== file.size) {
    await remove([file.storageKey]);
    await file.deleteOne();
    throw new HttpError(400, "Upload missing or size mismatch");
  }
  file.status = "READY";
  await file.save();
  if (file.kind === "cover") {
    const old = await ProjectFile.find({ project: file.project, kind: "cover", _id: { $ne: file._id } }).select("storageKey").lean();
    await remove(old.map((f) => f.storageKey));
    await ProjectFile.deleteMany({ _id: { $in: old.map((f) => f._id) } });
    await Project.updateOne({ _id: file.project }, { coverImageKey: file.storageKey });
  }
  res.json({ ok: true });
});

// Returns a short-lived signed download link.
r.get("/files/:id/download", optionalAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  const file = await ProjectFile.findOne({ _id: id, status: "READY" }).lean();
  const project = file && (await Project.findById(file.project).select("status creator").lean());
  if (!file || !project) throw new HttpError(404, "Not found");
  const mine = !!req.user && (String(project.creator) === req.user.id || req.user.role === "admin");
  if (project.status !== "PUBLISHED" && !mine) throw new HttpError(404, "Not found");
  res.json({ url: await signedGet(file.storageKey, file.filename) });
});

// Content for the in-browser viewers: text/source files and STL models only, with size caps.
const TEXT_EXT = ["ino", "py", "cpp", "c", "h", "md", "txt", "csv", "json"];
const MAX_TEXT = 256 * 1024;
const MAX_STL = 15 * 1024 * 1024;

r.get("/files/:id/content", optionalAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  const file = await ProjectFile.findOne({ _id: id, status: "READY" }).lean();
  const project = file && (await Project.findById(file.project).select("status creator").lean());
  if (!file || !project) throw new HttpError(404, "Not found");
  const mine = !!req.user && (String(project.creator) === req.user.id || req.user.role === "admin");
  if (project.status !== "PUBLISHED" && !mine) throw new HttpError(404, "Not found");

  const ext = file.filename.split(".").pop()!.toLowerCase();
  const text = TEXT_EXT.includes(ext);
  if (!text && ext !== "stl") throw new HttpError(415, "This file type can’t be previewed");
  if (file.size > (text ? MAX_TEXT : MAX_STL)) throw new HttpError(413, "This file is too large to preview");

  const bytes = await getBytes(file.storageKey);
  res.set({
    "Content-Type": text ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, max-age=300",
  });
  res.send(bytes);
});

r.delete("/files/:id", auth, requireCreator, async (req, res) => {
  const file = await ProjectFile.findOne({ _id: String(req.params.id), uploader: req.user!.id });
  if (!file) throw new HttpError(404, "Not found");
  await remove([file.storageKey]);
  if (file.kind === "cover") await Project.updateOne({ _id: file.project, coverImageKey: file.storageKey }, { $unset: { coverImageKey: 1 } });
  await file.deleteOne();
  res.json({ ok: true });
});

export default r;
