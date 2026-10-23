import { Router } from "express";
import { Types } from "mongoose";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Project, Like, Save, Follow, Comment, Notification, User, Report, REPORT_REASONS } from "../models.js";
import { auth, optionalAuth, requireVerified, parse, HttpError } from "../middleware.js";
import { card, SUMMARY } from "../present.js";
import { emitEvent } from "../webhooks.js";

const r = Router();

// Community actions only apply to published projects (number like "001" or id).
async function published(ref: string) {
  const q = /^\d{3,}(?:-F\d+)*$/.test(ref) ? { number: ref } : Types.ObjectId.isValid(ref) ? { _id: ref } : null;
  const p = q && (await Project.findOne({ ...q, status: "PUBLISHED" }).select("_id creator number title").lean());
  if (!p) throw new HttpError(404, "Not found");
  return p;
}

// Idempotent on/off with a counter that only moves when the row really changed.
async function setFlag(M: any, userId: string, projectId: unknown, on: boolean, field: "likes" | "saves") {
  if (on) {
    const res = await M.updateOne({ user: userId, project: projectId }, { $setOnInsert: { user: userId, project: projectId } }, { upsert: true });
    if (res.upsertedCount) await Project.updateOne({ _id: projectId }, { $inc: { [field]: 1 } });
  } else {
    const res = await M.deleteOne({ user: userId, project: projectId });
    if (res.deletedCount) await Project.updateOne({ _id: projectId }, { $inc: { [field]: -1 } });
  }
  const p: any = await Project.findById(projectId).select(field).lean();
  return Math.max(0, p?.[field] ?? 0);
}

function flagRoutes(path: "like" | "save", M: any, field: "likes" | "saves", key: "liked" | "saved") {
  r.put(`/projects/:ref/${path}`, auth, async (req, res) => {
    const p = await published(String(req.params.ref));
    res.json({ [key]: true, count: await setFlag(M, req.user!.id, p._id, true, field) });
  });
  r.delete(`/projects/:ref/${path}`, auth, async (req, res) => {
    const p = await published(String(req.params.ref));
    res.json({ [key]: false, count: await setFlag(M, req.user!.id, p._id, false, field) });
  });
}
flagRoutes("like", Like, "likes", "liked");
flagRoutes("save", Save, "saves", "saved");

// ---- Follow creators
async function findUser(username: string) {
  const u = await User.findOne({ username: username.toLowerCase() }).select("_id username").lean();
  if (!u) throw new HttpError(404, "Not found");
  return u;
}
const followerCount = async (id: unknown) => ((await User.findById(id).select("followers").lean()) as any)?.followers ?? 0;

r.put("/users/:username/follow", auth, async (req, res) => {
  const t = await findUser(String(req.params.username));
  if (String(t._id) === req.user!.id) throw new HttpError(400, "You can’t follow yourself");
  const res2 = await Follow.updateOne({ follower: req.user!.id, following: t._id }, { $setOnInsert: { follower: req.user!.id, following: t._id } }, { upsert: true });
  if (res2.upsertedCount) {
    await User.updateOne({ _id: t._id }, { $inc: { followers: 1 } });
    const me = await User.findById(req.user!.id).select("username").lean();
    await Notification.create({ user: t._id, type: "follow", actorUsername: me!.username });
    emitEvent(t._id, "user.followed", { follower: me!.username });
  }
  res.json({ following: true, followers: await followerCount(t._id) });
});

r.delete("/users/:username/follow", auth, async (req, res) => {
  const t = await findUser(String(req.params.username));
  const res2 = await Follow.deleteOne({ follower: req.user!.id, following: t._id });
  if (res2.deletedCount) await User.updateOne({ _id: t._id }, { $inc: { followers: -1 } });
  res.json({ following: false, followers: await followerCount(t._id) });
});

// ---- Comments (technical discussion, replies one level deep)
const commentLimit = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

r.get("/projects/:ref/comments", optionalAuth, async (req, res) => {
  const p = await published(String(req.params.ref));
  const items = await Comment.find({ project: p._id }).sort({ createdAt: 1 }).limit(500).lean();
  res.json({
    total: items.length,
    items: items.map((c) => ({
      id: c._id,
      author: c.authorUsername,
      body: c.body,
      parent: c.parent ?? null,
      createdAt: c.createdAt,
      canDelete: !!req.user && (String(c.author) === req.user.id || String(p.creator) === req.user.id || req.user.role === "admin"),
    })),
  });
});

r.post("/projects/:ref/comments", commentLimit, auth, requireVerified, async (req, res) => {
  const d = parse(z.object({ body: z.string().trim().min(1).max(2000), parent: z.string().optional() }), req.body);
  const p = await published(String(req.params.ref));
  const me = await User.findById(req.user!.id).select("username").lean();

  let parent: Types.ObjectId | undefined;
  let notify = String(p.creator);
  let type: "comment" | "reply" = "comment";
  if (d.parent) {
    if (!Types.ObjectId.isValid(d.parent)) throw new HttpError(400, "Invalid parent");
    const par = await Comment.findOne({ _id: d.parent, project: p._id }).lean();
    if (!par) throw new HttpError(404, "Comment not found");
    parent = (par.parent ?? par._id) as Types.ObjectId; // replying to a reply attaches to the top comment
    notify = String(par.author);
    type = "reply";
  }
  const c = await Comment.create({ project: p._id, author: req.user!.id, authorUsername: me!.username, body: d.body, parent });
  await Project.updateOne({ _id: p._id }, { $inc: { commentCount: 1 } });
  if (notify !== req.user!.id) {
    await Notification.create({ user: notify, type, actorUsername: me!.username, projectNumber: p.number, projectTitle: p.title });
  }
  if (String(p.creator) !== req.user!.id) emitEvent(p.creator, "comment.created", { project: p.number, commentId: c.id, author: me!.username, parent: parent ? String(parent) : null, body: d.body });
  res.status(201).json({ id: c.id });
});

r.delete("/comments/:id", auth, async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  const c = await Comment.findById(id);
  if (!c) throw new HttpError(404, "Not found");
  const proj: any = await Project.findById(c.project).select("creator").lean();
  const ok = String(c.author) === req.user!.id || String(proj?.creator) === req.user!.id || req.user!.role === "admin";
  if (!ok) throw new HttpError(403, "Not allowed");
  const replies = await Comment.find({ parent: c._id }).select("_id").lean();
  const gone = await Comment.deleteMany({ _id: { $in: [c._id, ...replies.map((x) => x._id)] } });
  await Project.updateOne({ _id: c.project }, { $inc: { commentCount: -gone.deletedCount } });
  res.json({ ok: true });
});

// ---- Saved projects and the following feed
r.get("/me/saved", auth, async (req, res) => {
  const saves = await Save.find({ user: req.user!.id }).sort({ createdAt: -1 }).limit(100).lean();
  const ps = await Project.find({ _id: { $in: saves.map((s: any) => s.project) }, status: "PUBLISHED" }).select(SUMMARY).lean();
  const byId = new Map(ps.map((p: any) => [String(p._id), p]));
  const ordered = saves.map((s: any) => byId.get(String(s.project))).filter(Boolean);
  res.json({ items: await Promise.all(ordered.map(card)) });
});

r.get("/feed", auth, async (req, res) => {
  const follows = await Follow.find({ follower: req.user!.id }).select("following").lean();
  const ids = follows.map((f: any) => f.following);
  const [items, people] = await Promise.all([
    Project.find({ creator: { $in: ids }, status: "PUBLISHED" }).sort({ publishedAt: -1 }).limit(30).select(SUMMARY).lean(),
    User.find({ _id: { $in: ids } }).select("username displayName").lean(),
  ]);
  res.json({ items: await Promise.all(items.map(card)), following: people.map((u) => ({ username: u.username, displayName: u.displayName })) });
});

// ---- Notifications
r.get("/notifications", auth, async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user!.id }).sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ user: req.user!.id, read: false }),
  ]);
  res.json({
    unread,
    items: items.map((n) => ({ id: n._id, type: n.type, actor: n.actorUsername, projectNumber: n.projectNumber, projectTitle: n.projectTitle, message: n.message, read: n.read, createdAt: n.createdAt })),
  });
});

r.post("/notifications/read", auth, async (req, res) => {
  await Notification.updateMany({ user: req.user!.id, read: false }, { read: true });
  res.json({ ok: true });
});

// ---- Reports: anyone signed in can flag a project or a comment for the moderators
const reportLimit = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

r.post("/reports", reportLimit, auth, async (req, res) => {
  const d = parse(
    z.object({
      type: z.enum(["project", "comment"]),
      target: z.string().max(40),
      reason: z.enum(REPORT_REASONS),
      details: z.string().trim().max(500).default(""),
    }),
    req.body
  );
  let project: any, comment: any;
  if (d.type === "project") {
    project = await published(d.target);
  } else {
    if (!Types.ObjectId.isValid(d.target)) throw new HttpError(404, "Not found");
    comment = await Comment.findById(d.target).lean();
    project = comment && (await Project.findById(comment.project).select("_id number title").lean());
    if (!comment || !project) throw new HttpError(404, "Not found");
  }
  const me = await User.findById(req.user!.id).select("username").lean();
  try {
    await Report.create({
      reporter: req.user!.id,
      reporterUsername: me!.username,
      targetType: d.type,
      project: project._id,
      projectNumber: project.number,
      projectTitle: project.title,
      comment: comment?._id,
      snapshot: comment ? String(comment.body).slice(0, 300) : project.title,
      reason: d.reason,
      details: d.details,
    });
  } catch (e: any) {
    if (e?.code === 11000) throw new HttpError(409, "You have already reported this");
    throw e;
  }
  res.status(201).json({ ok: true });
});

export default r;
