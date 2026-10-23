import { Router, type Request } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { LearningPath, Lesson, Progress, Project } from "../models.js";
import { auth, optionalAuth, requireAdmin, parse, HttpError } from "../middleware.js";
import { card, SUMMARY } from "../present.js";

const r = Router();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;
const nums = z.array(z.string().regex(/^\d{3,}(?:-F\d+)*$/)).max(50);

async function findPath(slug: string) {
  const p = await LearningPath.findOne({ slug, published: true }).lean();
  if (!p) throw new HttpError(404, "Not found");
  return p;
}
const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  return id;
};

// ---- Public reads (progress is included when signed in)
r.get("/", optionalAuth, async (req, res) => {
  const paths = await LearningPath.find({ published: true }).sort({ order: 1 }).lean();
  const lc = await Lesson.aggregate([{ $group: { _id: "$path", n: { $sum: 1 } } }]);
  const lessons = new Map(lc.map((x) => [String(x._id), x.n as number]));
  const live = await Project.find({ number: { $in: paths.flatMap((p) => p.projectNumbers) }, status: "PUBLISHED" }).select("number").lean();
  const liveSet = new Set(live.map((p) => p.number));
  const done = new Map<string, number>();
  if (req.user) {
    const d = await Progress.aggregate([
      { $match: { user: new Types.ObjectId(req.user.id), kind: "lesson" } },
      { $group: { _id: "$path", n: { $sum: 1 } } },
    ]);
    d.forEach((x) => done.set(String(x._id), x.n));
  }
  res.json({
    items: paths.map((p) => ({
      slug: p.slug,
      title: p.title,
      level: p.level,
      summary: p.summary,
      order: p.order,
      lessons: lessons.get(String(p._id)) ?? 0,
      projects: p.projectNumbers.filter((n) => liveSet.has(n)).length,
      done: done.get(String(p._id)) ?? 0,
      signedIn: !!req.user,
    })),
  });
});

r.get("/:slug", optionalAuth, async (req, res) => {
  const p = await findPath(String(req.params.slug));
  const lessons = await Lesson.find({ path: p._id }).sort({ order: 1 }).select("slug title minutes").lean();
  const found = await Project.find({ number: { $in: p.projectNumbers }, status: "PUBLISHED" }).select(SUMMARY).lean();
  const projects = found.sort((a, b) => p.projectNumbers.indexOf(a.number!) - p.projectNumbers.indexOf(b.number!));

  const doneL = new Set<string>(), doneP = new Set<string>();
  if (req.user) {
    const rows = await Progress.find({ user: req.user.id, path: p._id }).lean();
    rows.forEach((x) => (x.kind === "lesson" ? doneL : doneP).add(x.ref));
  }
  const cards = await Promise.all(projects.map(async (pr) => ({ ...(await card(pr)), done: doneP.has(pr.number!) })));
  res.json({
    slug: p.slug,
    title: p.title,
    level: p.level,
    summary: p.summary,
    signedIn: !!req.user,
    lessons: lessons.map((l) => ({ id: l._id, slug: l.slug, title: l.title, minutes: l.minutes, done: doneL.has(String(l._id)) })),
    projects: cards,
    progress: {
      lessonsDone: lessons.filter((l) => doneL.has(String(l._id))).length,
      lessonsTotal: lessons.length,
      projectsDone: cards.filter((c) => c.done).length,
      projectsTotal: cards.length,
    },
  });
});

r.get("/:slug/lessons/:lesson", optionalAuth, async (req, res) => {
  const p = await findPath(String(req.params.slug));
  const all = await Lesson.find({ path: p._id }).sort({ order: 1 }).select("slug title").lean();
  const i = all.findIndex((l) => l.slug === String(req.params.lesson));
  if (i < 0) throw new HttpError(404, "Not found");
  const l = (await Lesson.findById(all[i]._id).lean())!;
  const done = req.user ? !!(await Progress.exists({ user: req.user.id, kind: "lesson", ref: String(l._id) })) : false;
  const link = (x?: { slug: string; title: string }) => (x ? { slug: x.slug, title: x.title } : null);
  res.json({ id: l._id, title: l.title, body: l.body, minutes: l.minutes, path: { slug: p.slug, title: p.title }, index: i + 1, total: all.length, prev: link(all[i - 1]), next: link(all[i + 1]), done });
});

// ---- Progress (idempotent)
async function setProgress(req: Request, pathId: unknown, kind: "lesson" | "project", ref: string, on: boolean) {
  const key = { user: req.user!.id, kind, ref };
  if (on) await Progress.updateOne(key, { $setOnInsert: { ...key, path: pathId } }, { upsert: true });
  else await Progress.deleteOne(key);
}

for (const [method, on] of [["put", true], ["delete", false]] as const) {
  r[method]("/lessons/:id/complete", auth, async (req, res) => {
    const l = await Lesson.findById(oid(String(req.params.id))).select("path").lean();
    if (!l) throw new HttpError(404, "Not found");
    await setProgress(req, l.path, "lesson", String(req.params.id), on);
    res.json({ done: on });
  });
  r[method]("/:slug/projects/:number/complete", auth, async (req, res) => {
    const p = await findPath(String(req.params.slug));
    const number = String(req.params.number);
    if (!p.projectNumbers.includes(number)) throw new HttpError(404, "Project is not part of this path");
    await setProgress(req, p._id, "project", number, on);
    res.json({ done: on });
  });
}

// ---- Admin: manage learning content
const pathFields = z.object({
  title: z.string().trim().min(1).max(120),
  level: z.enum(LEVELS),
  summary: z.string().trim().max(500),
  order: z.number().int().min(0).max(1000),
  projectNumbers: nums,
  published: z.boolean(),
});
const lessonFields = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20000),
  minutes: z.number().int().min(1).max(240),
  order: z.number().int().min(0).max(1000),
});

r.post("/", auth, requireAdmin, async (req, res) => {
  const d = parse(pathFields.partial({ level: true, summary: true, order: true, projectNumbers: true, published: true }), req.body);
  const p = await LearningPath.create({ ...d, slug: slugify(d.title) });
  res.status(201).json({ slug: p.slug });
});

r.patch("/lessons/:id", auth, requireAdmin, async (req, res) => {
  const d = parse(lessonFields.partial(), req.body);
  const l = await Lesson.findByIdAndUpdate(oid(String(req.params.id)), d);
  if (!l) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

r.delete("/lessons/:id", auth, requireAdmin, async (req, res) => {
  const id = oid(String(req.params.id));
  await Promise.all([Lesson.deleteOne({ _id: id }), Progress.deleteMany({ kind: "lesson", ref: id })]);
  res.json({ ok: true });
});

r.patch("/:slug", auth, requireAdmin, async (req, res) => {
  const d = parse(pathFields.partial(), req.body);
  const p = await LearningPath.findOneAndUpdate({ slug: String(req.params.slug) }, d);
  if (!p) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

r.post("/:slug/lessons", auth, requireAdmin, async (req, res) => {
  const d = parse(lessonFields.partial({ body: true, minutes: true, order: true }), req.body);
  const p = await LearningPath.findOne({ slug: String(req.params.slug) }).select("_id").lean();
  if (!p) throw new HttpError(404, "Not found");
  const order = d.order ?? (await Lesson.countDocuments({ path: p._id })) + 1;
  const l = await Lesson.create({ ...d, order, path: p._id, slug: slugify(d.title) });
  res.status(201).json({ id: l.id, slug: l.slug });
});

export default r;
