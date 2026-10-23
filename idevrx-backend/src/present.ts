import { mediaUrl } from "./storage.js";

export const SUMMARY =
  "number slug title category difficulty buildTime cost tags coverImageKey creatorUsername version publishedAt views featured";

export async function card(p: any) {
  return {
    number: p.number,
    slug: p.slug,
    title: p.title,
    category: p.category,
    difficulty: p.difficulty,
    buildTime: p.buildTime,
    cost: p.cost,
    tags: p.tags,
    creator: p.creatorUsername,
    version: p.version,
    publishedAt: p.publishedAt,
    views: p.views,
    featured: !!p.featured,
    cover: p.coverImageKey ? await mediaUrl(p.coverImageKey) : null,
  };
}
