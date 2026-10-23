import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Project, User, Follow, ROLES } from "../models.js";
import { auth, optionalAuth, requireAdmin, requireVerified, parse, HttpError } from "../middleware.js";
import { card, SUMMARY } from "../present.js";
import { config } from "../config.js";

const r = Router();

r.get("/me", auth, async (req, res) => {
  const u = await User.findById(req.user!.id).select("username displayName bio email emailVerified role").lean();
  if (!u) throw new HttpError(404, "Not found");
  res.json({ username: u.username, displayName: u.displayName, bio: u.bio ?? "", email: u.email, emailVerified: !!u.emailVerified, role: u.role });
});

r.patch("/me", auth, async (req, res) => {
  const d = parse(z.object({ displayName: z.string().trim().min(1).max(60), bio: z.string().trim().max(500) }).partial(), req.body);
  await User.updateOne({ _id: req.user!.id }, d);
  res.json({ ok: true });
});

r.post("/me/become-creator", auth, requireVerified, async (req, res) => {
  if (config.creatorAutoApprove) {
    await User.updateOne({ _id: req.user!.id, role: "user" }, { role: "creator" });
    res.json({ role: "creator" });
  } else {
    await User.updateOne({ _id: req.user!.id }, { creatorRequested: true });
    res.status(202).json({ role: "user", message: "Request recorded. An admin will review it." });
  }
});

r.patch("/:id/role", auth, requireAdmin, async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(ROLES) }), req.body);
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  await User.updateOne({ _id: id }, { role, creatorRequested: false });
  res.json({ ok: true });
});

r.get("/:username", optionalAuth, async (req, res) => {
  const u = await User.findOne({ username: String(req.params.username).toLowerCase() })
    .select("username displayName bio createdAt followers")
    .lean();
  if (!u) throw new HttpError(404, "Not found");
  const items = await Project.find({ creator: u._id, status: "PUBLISHED" }).sort({ publishedAt: -1 }).select(SUMMARY).lean();
  res.json({
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    joined: u.createdAt,
    followers: u.followers ?? 0,
    viewer: { following: !!req.user && !!(await Follow.exists({ follower: req.user.id, following: u._id })) },
    projectCount: items.length,
    projects: await Promise.all(items.map(card)),
  });
});

export default r;
