import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Project, User, Report, Notification, LearningPath, Lesson, STATUSES } from "../models.js";
import { auth, requireAdmin, parse, HttpError } from "../middleware.js";

const r = Router();
r.use(auth, requireAdmin);

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  return id;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- Reports
r.get("/reports", async (req, res) => {
  const q = parse(z.object({ status: z.enum(["open", "resolved", "dismissed"]).default("open") }), req.query);
  const items = await Report.find({ status: q.status }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({
    items: items.map((x) => ({
      id: x._id, type: x.targetType, reason: x.reason, details: x.details, reporter: x.reporterUsername, createdAt: x.createdAt,
      projectId: x.project, projectNumber: x.projectNumber, projectTitle: x.projectTitle, commentId: x.comment ?? null, snapshot: x.snapshot,
    })),
  });
});

r.patch("/reports/:id", async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["resolved", "dismissed"]) }), req.body);
  const rep = await Report.findByIdAndUpdate(oid(String(req.params.id)), { status, handledBy: req.user!.id });
  if (!rep) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

// ---- Projects: every status, so moderators can find anything
r.get("/projects", async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(100).default(""), status: z.enum(STATUSES).optional() }), req.query);
  const f: Record<string, unknown> = {};
  if (q.q) f.title = { $regex: escapeRe(q.q), $options: "i" };
  if (q.status) f.status = q.status;
  const items = await Project.find(f).sort({ updatedAt: -1 }).limit(100).select("number title status creatorUsername featured updatedAt").lean();
  res.json({ items: items.map((p) => ({ id: p._id, number: p.number ?? null, title: p.title, status: p.status, creator: p.creatorUsername, featured: !!p.featured, updatedAt: p.updatedAt })) });
});

// Unpublishing always tells the creator why.
r.post("/projects/:id/unpublish", async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().max(300).default("") }), req.body ?? {});
  const p = await Project.findById(oid(String(req.params.id)));
  if (!p) throw new HttpError(404, "Not found");
  if (p.status !== "PUBLISHED") throw new HttpError(409, "Project is not published");
  p.status = "UNPUBLISHED";
  p.featured = false;
  p.moderationNote = note;
  await p.save();
  await Notification.create({ user: p.creator, type: "moderation", actorUsername: "Idevrx moderators", projectNumber: p.number, projectTitle: p.title, message: note || "No reason given." });
  res.json({ ok: true });
});

r.put("/projects/:id/feature", async (req, res) => {
  const p = await Project.findOne({ _id: oid(String(req.params.id)), status: "PUBLISHED" });
  if (!p) throw new HttpError(404, "Not found");
  const first = !p.featuredAt;
  p.featured = true;
  p.featuredAt ??= new Date();
  await p.save();
  if (first) await Notification.create({ user: p.creator, type: "featured", actorUsername: "Idevrx", projectNumber: p.number, projectTitle: p.title });
  res.json({ ok: true });
});

r.delete("/projects/:id/feature", async (req, res) => {
  await Project.updateOne({ _id: oid(String(req.params.id)) }, { featured: false });
  res.json({ ok: true });
});

// ---- Users
r.get("/users", async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(100).default("") }), req.query);
  const f = q.q ? { $or: [{ username: { $regex: escapeRe(q.q), $options: "i" } }, { email: { $regex: escapeRe(q.q), $options: "i" } }] } : {};
  const items = await User.find(f).sort({ createdAt: -1 }).limit(50).select("username displayName email role suspended createdAt").lean();
  res.json({ items: items.map((u) => ({ id: u._id, username: u.username, displayName: u.displayName, email: u.email, role: u.role, suspended: !!u.suspended, createdAt: u.createdAt })) });
});

r.patch("/users/:id/suspend", async (req, res) => {
  const { suspended } = parse(z.object({ suspended: z.boolean() }), req.body);
  const u = await User.findById(oid(String(req.params.id)));
  if (!u) throw new HttpError(404, "Not found");
  if (u.role === "admin") throw new HttpError(400, "Admins can’t be suspended. Change the role first.");
  u.suspended = suspended;
  await u.save();
  res.json({ ok: true });
});

// ---- Learning content, including hidden paths and lesson text
r.get("/learning", async (_req, res) => {
  const [paths, lessons] = await Promise.all([LearningPath.find().sort({ order: 1 }).lean(), Lesson.find().sort({ order: 1 }).lean()]);
  const byPath = new Map<string, unknown[]>();
  for (const l of lessons) {
    const k = String(l.path);
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k)!.push({ id: l._id, slug: l.slug, title: l.title, minutes: l.minutes, order: l.order, body: l.body });
  }
  res.json({
    items: paths.map((p) => ({ slug: p.slug, title: p.title, level: p.level, summary: p.summary, order: p.order, published: p.published, projectNumbers: p.projectNumbers, lessons: byPath.get(String(p._id)) ?? [] })),
  });
});

export default r;
