import { Router, type Request } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Project, ProjectFile, ProjectVersion, User, Like, Save, LearningPath, nextNumber, CATEGORIES } from "../models.js";
import { auth, optionalAuth, requireCreator, requireVerified, parse, HttpError } from "../middleware.js";
import { card, SUMMARY } from "../present.js";
import { csvCell, diffSnapshots } from "../lib.js";
import { emitEvent } from "../webhooks.js";
import { config } from "../config.js";
import { mediaUrl, remove } from "../storage.js";

const r = Router();
const NUM = /^\d{3,}(?:-F\d+)*$/; // 001, or a fork such as 001-F1
const VER = /^\d{1,3}\.\d{1,3}$/;
const str = (n: number) => z.string().trim().max(n);

const fields = z
  .object({
    title: str(120),
    description: str(2000),
    category: z.enum(CATEGORIES),
    difficulty: z.number().int().min(1).max(4),
    buildTime: str(60),
    cost: str(60),
    buildStatus: z.enum(["Completed", "In progress"]),
    tags: z.array(z.string().trim().min(1).max(30)).max(15),
    controller: str(80),
    language: str(80),
    sensors: str(200),
    actuators: str(200),
    power: str(100),
    communication: str(100),
    components: z.array(z.object({ name: str(120), qty: z.number().int().min(1).max(10000).default(1), spec: str(200).default("") })).max(100),
    why: str(5000),
    steps: z.array(str(2000)).max(100),
    problems: str(5000),
    nextVersion: str(5000),
    youtubeUrl: str(200),
    allowForks: z.boolean(),
  })
  .partial();

export const ytId = (u: string) =>
  u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/)?.[1] ?? "";

const withYt = <T extends { youtubeUrl?: string }>(d: T) => {
  if (d.youtubeUrl === undefined) return d;
  const id = ytId(d.youtubeUrl);
  if (d.youtubeUrl && !id) throw new HttpError(400, "That is not a valid YouTube link");
  return { ...d, youtubeId: id };
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bump = (v: string) => {
  const [a, b] = v.split(".");
  return `${a}.${Number(b) + 1}`;
};

async function owned(req: Request) {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  const p = await Project.findOne({ _id: id, creator: req.user!.id });
  if (!p) throw new HttpError(404, "Not found");
  return p;
}

async function viewerState(req: Request, projectId: unknown) {
  if (!req.user) return { liked: false, saved: false };
  const [l, s] = await Promise.all([Like.exists({ user: req.user.id, project: projectId }), Save.exists({ user: req.user.id, project: projectId })]);
  return { liked: !!l, saved: !!s };
}

async function forkNumber(originId: unknown, originNumber: string) {
  const o: any = await Project.findOneAndUpdate({ _id: originId }, { $inc: { forkCount: 1 } }, { new: true }).select("forkCount").lean();
  return `${originNumber}-F${o.forkCount}`;
}

async function publishedBy(ref: string, select = "") {
  const q = NUM.test(ref) ? { number: ref } : Types.ObjectId.isValid(ref) ? { _id: ref } : null;
  const p = q && (await Project.findOne({ ...q, status: "PUBLISHED" }).select(select).lean());
  if (!p) throw new HttpError(404, "Not found");
  return p as any;
}

// Browse published projects
r.get("/", async (req, res) => {
  const q = parse(
    z.object({
      category: z.enum(CATEGORIES).optional(),
      difficulty: z.coerce.number().int().min(1).max(4).optional(),
      tag: z.string().max(30).optional(),
      creator: z.string().max(24).optional(),
      featured: z.enum(["1"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    req.query
  );
  const f: Record<string, unknown> = { status: "PUBLISHED" };
  if (q.category) f.category = q.category;
  if (q.difficulty) f.difficulty = q.difficulty;
  if (q.tag) f.tags = q.tag;
  if (q.creator) f.creatorUsername = q.creator.toLowerCase();
  if (q.featured) f.featured = true;
  const [items, total] = await Promise.all([
    Project.find(f).sort({ publishedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).select(SUMMARY).lean(),
    Project.countDocuments(f),
  ]);
  res.json({ items: await Promise.all(items.map(card)), total, page: q.page });
});

// Creator dashboard
r.get("/mine", auth, requireCreator, async (req, res) => {
  const items = await Project.find({ creator: req.user!.id }).sort({ updatedAt: -1 }).select("number title status version updatedAt").lean();
  res.json({ items });
});

r.post("/", auth, requireCreator, async (req, res) => {
  const d = withYt(parse(fields, req.body));
  const u = await User.findById(req.user!.id).select("username").lean();
  const p = await Project.create({ ...d, creator: req.user!.id, creatorUsername: u!.username, status: "DRAFT" });
  res.status(201).json({ id: p.id });
});

// One project, by number ("001") or id. Drafts are visible to the owner and admins only.
r.get("/:ref", optionalAuth, async (req, res) => {
  const ref = String(req.params.ref);
  const q = NUM.test(ref) ? { number: ref } : Types.ObjectId.isValid(ref) ? { _id: ref } : null;
  const p: any = q && (await Project.findOne(q).lean());
  if (!p) throw new HttpError(404, "Not found");
  const mine = !!req.user && (String(p.creator) === req.user.id || req.user.role === "admin");
  if (p.status !== "PUBLISHED" && !mine) throw new HttpError(404, "Not found");
  if (!mine) void Project.updateOne({ _id: p._id }, { $inc: { views: 1 } }).exec();

  const view = mine && p.pending ? { ...p, ...p.pending } : p;
  const files = await ProjectFile.find({ project: p._id, status: "READY", kind: { $ne: "cover" } }).select("filename size kind").lean();
  const { pending, __v, creator, coverImageKey, ...rest } = view;
  res.json({
    ...rest,
    id: p._id,
    creator: p.creatorUsername,
    hasPendingChanges: mine && !!p.pending,
    likes: p.likes ?? 0,
    saves: p.saves ?? 0,
    commentCount: p.commentCount ?? 0,
    viewer: await viewerState(req, p._id),
    paths: p.number ? (await LearningPath.find({ published: true, projectNumbers: p.number }).select("slug title").lean()).map((x) => ({ slug: x.slug, title: x.title })) : [],
    cover: coverImageKey ? await mediaUrl(coverImageKey) : null,
    files: files.map((f) => ({ id: f._id, filename: f.filename, size: f.size, kind: f.kind })),
  });
});

r.patch("/:id", auth, requireCreator, async (req, res) => {
  const p = await owned(req);
  const { allowForks, ...d } = withYt(parse(fields, req.body)) as any;
  if (allowForks !== undefined) p.allowForks = allowForks; // a setting, not page content: applies immediately
  if (p.status === "PUBLISHED") {
    // Live page stays unchanged until the creator publishes the new version.
    if (Object.keys(d).length) {
      p.pending = { ...((p.pending as object) ?? {}), ...d };
      p.markModified("pending");
    }
  } else {
    Object.assign(p, d);
  }
  await p.save();
  res.json({ ok: true, status: p.status });
});

const check = (p: any, fileCount: number) =>
  [
    { label: "Title", ok: !!p.title?.trim() },
    { label: "Description", ok: !!p.description?.trim() },
    { label: "Cover image", ok: !!p.coverImageKey },
    { label: "Components", ok: p.components?.some((c: any) => c.name?.trim()) },
    { label: "Build instructions", ok: p.steps?.some((s: string) => s.trim()) },
    { label: "Files", ok: fileCount > 0 },
    { label: "Category", ok: !!p.category },
  ];

r.post("/:id/publish", auth, requireCreator, requireVerified, async (req, res) => {
  const { note } = parse(z.object({ note: str(300).optional() }), req.body ?? {});
  const p = await owned(req);
  if (p.pending) {
    Object.assign(p, p.pending);
    p.pending = undefined;
  }
  const fileCount = await ProjectFile.countDocuments({ project: p._id, status: "READY", kind: { $ne: "cover" } });
  const missing = check(p, fileCount).filter((c) => !c.ok).map((c) => c.label);
  if (missing.length) throw new HttpError(422, "Project is not ready to publish", { missing });

  const first = !p.number;
  if (first) p.number = p.forkOfNumber ? await forkNumber(p.forkOf, p.forkOfNumber) : await nextNumber();
  p.version = first ? "1.0" : bump(p.version);
  p.slug = slugify(p.title);
  p.status = "PUBLISHED";
  p.publishedAt ??= new Date();
  const entry = { version: p.version, note: note || (first ? "Initial release" : "Updated"), date: new Date() };
  p.history.push(entry);
  await p.save();
  await ProjectVersion.create({ project: p._id, version: entry.version, note: entry.note, snapshot: p.toObject() });
  emitEvent(p.creator, "project.published", { number: p.number, title: p.title, version: p.version, url: `${config.APP_URL}/#project-${p.number}` });
  res.json({ number: p.number, slug: p.slug, version: p.version });
});

r.post("/:id/unpublish", auth, requireCreator, async (req, res) => {
  const p = await owned(req);
  p.status = "UNPUBLISHED";
  await p.save();
  res.json({ ok: true });
});

r.delete("/:id", auth, requireCreator, async (req, res) => {
  const p = await owned(req);
  if (p.status === "PUBLISHED") throw new HttpError(409, "Unpublish the project before deleting it");
  const files = await ProjectFile.find({ project: p._id }).select("storageKey").lean();
  await remove(files.map((f) => f.storageKey));
  await Promise.all([ProjectFile.deleteMany({ project: p._id }), ProjectVersion.deleteMany({ project: p._id }), p.deleteOne()]);
  res.json({ ok: true });
});

// ---- Phase 5: bill of materials, version comparison, forks
r.get("/:ref/bom.csv", async (req, res) => {
  const p = await publishedBy(String(req.params.ref), "number components");
  const rows = [["Component", "Quantity", "Specification"], ...p.components.map((c: any) => [c.name, String(c.qty), c.spec])];
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="project-${p.number}-bom.csv"` });
  res.send(rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
});

r.get("/:ref/compare", async (req, res) => {
  const q = parse(z.object({ from: z.string().regex(VER), to: z.string().regex(VER) }), req.query);
  const p = await publishedBy(String(req.params.ref), "_id");
  const [a, b] = await Promise.all([
    ProjectVersion.findOne({ project: p._id, version: q.from }).lean(),
    ProjectVersion.findOne({ project: p._id, version: q.to }).lean(),
  ]);
  if (!a || !b) throw new HttpError(404, "Version not found");
  res.json({ from: q.from, to: q.to, ...diffSnapshots(a.snapshot, b.snapshot) });
});

// A fork copies the documentation into a new draft owned by the forker. Files and cover are not copied:
// the fork needs its own media, and the original files stay on the original project.
const FORK_FIELDS = ["description", "category", "difficulty", "buildTime", "cost", "buildStatus", "tags", "controller", "language", "sensors", "actuators", "power", "communication", "components", "why", "steps", "problems", "nextVersion", "youtubeUrl", "youtubeId"];
r.post("/:ref/fork", auth, requireCreator, async (req, res) => {
  const o = await publishedBy(String(req.params.ref));
  if (o.allowForks === false) throw new HttpError(403, "The creator has turned off forking for this project");
  const me = await User.findById(req.user!.id).select("username").lean();
  const copy = Object.fromEntries(FORK_FIELDS.map((k) => [k, o[k]]));
  const p = await Project.create({
    ...copy,
    title: `${o.title} (fork)`.slice(0, 120),
    creator: req.user!.id,
    creatorUsername: me!.username,
    status: "DRAFT",
    forkOf: o._id,
    forkOfNumber: o.number,
    forkOfCreator: o.creatorUsername,
  });
  res.status(201).json({ id: p.id });
});

export default r;
