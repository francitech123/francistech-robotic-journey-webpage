import { Router } from "express";
import { z } from "zod";
import { Project, LearningPath, CATEGORIES } from "../models.js";
import { parse } from "../middleware.js";
import { card, SUMMARY } from "../present.js";

const r = Router();

r.get("/", async (req, res) => {
  const q = parse(
    z.object({
      q: z.string().trim().max(100).default(""),
      category: z.enum(CATEGORIES).optional(),
      difficulty: z.coerce.number().int().min(1).max(4).optional(),
      tag: z.string().max(30).optional(),
      language: z.string().max(80).optional(),
      creator: z.string().max(24).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    req.query
  );
  const match: Record<string, unknown> = { status: "PUBLISHED" };
  if (q.q) match.$text = { $search: q.q };
  if (q.category) match.category = q.category;
  if (q.difficulty) match.difficulty = q.difficulty;
  if (q.tag) match.tags = q.tag;
  if (q.language) match.language = q.language;
  if (q.creator) match.creatorUsername = q.creator.toLowerCase();

  const find = Project.find(match, q.q ? { score: { $meta: "textScore" } } : undefined)
    .select(SUMMARY)
    .sort(q.q ? { score: { $meta: "textScore" } } : { publishedAt: -1 })
    .skip((q.page - 1) * q.limit)
    .limit(q.limit)
    .lean();

  const [items, facets] = await Promise.all([
    find,
    Project.aggregate([
      { $match: match },
      {
        $facet: {
          total: [{ $count: "n" }],
          category: [{ $group: { _id: "$category", n: { $sum: 1 } } }],
          difficulty: [{ $group: { _id: "$difficulty", n: { $sum: 1 } } }],
          tags: [{ $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }],
          creators: [{ $group: { _id: "$creatorUsername", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }],
        },
      },
    ]),
  ]);
  const f = facets[0];
  const learning = q.q ? await LearningPath.find({ published: true, $text: { $search: q.q } }).select("slug title level").limit(5).lean() : [];
  res.json({
    items: await Promise.all(items.map(card)),
    total: f.total[0]?.n ?? 0,
    page: q.page,
    facets: { category: f.category, difficulty: f.difficulty, tags: f.tags, creators: f.creators },
    learning: learning.map((l) => ({ slug: l.slug, title: l.title, level: l.level })),
  });
});

export default r;
