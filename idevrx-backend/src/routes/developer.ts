import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { Types } from "mongoose";
import { z } from "zod";
import { ApiKey, Webhook, WEBHOOK_EVENTS } from "../models.js";
import { auth, requireCreator, sessionOnly, parse, HttpError } from "../middleware.js";
import { sha256 } from "../tokens.js";
import { validateWebhookUrl } from "../net.js";
import { sendOnce } from "../webhooks.js";

const r = Router();
const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new HttpError(404, "Not found");
  return id;
};

// ---- API keys (managed with a signed-in session only)
r.post("/keys", auth, sessionOnly, async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(["read", "write"]) }), req.body);
  if ((await ApiKey.countDocuments({ user: req.user!.id, revokedAt: { $exists: false } })) >= 10) throw new HttpError(400, "You can have at most 10 active keys");
  const key = "idv_" + randomBytes(32).toString("base64url");
  const k = await ApiKey.create({ user: req.user!.id, name: d.name, scope: d.scope, prefix: key.slice(0, 12), hash: sha256(key) });
  res.status(201).json({ id: k.id, key, name: k.name, scope: k.scope, prefix: k.prefix }); // the only time the key is shown
});

r.get("/keys", auth, sessionOnly, async (req, res) => {
  const items = await ApiKey.find({ user: req.user!.id, revokedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
  res.json({ items: items.map((k) => ({ id: k._id, name: k.name, scope: k.scope, prefix: k.prefix, lastUsedAt: k.lastUsedAt ?? null, createdAt: k.createdAt })) });
});

r.delete("/keys/:id", auth, sessionOnly, async (req, res) => {
  const k = await ApiKey.findOneAndUpdate({ _id: oid(String(req.params.id)), user: req.user!.id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  if (!k) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

// ---- Webhooks (creators)
const testLimit = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const guard = [auth, sessionOnly, requireCreator];

r.post("/webhooks", ...guard, async (req, res) => {
  const d = parse(z.object({ url: z.string().trim().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }), req.body);
  const bad = validateWebhookUrl(d.url);
  if (bad) throw new HttpError(400, bad);
  if ((await Webhook.countDocuments({ user: req.user!.id })) >= 5) throw new HttpError(400, "You can have at most 5 webhooks");
  const secret = randomBytes(24).toString("hex");
  const h = await Webhook.create({ user: req.user!.id, url: d.url, events: [...new Set(d.events)], secret });
  res.status(201).json({ id: h.id, secret }); // the only time the secret is shown
});

r.get("/webhooks", ...guard, async (req, res) => {
  const items = await Webhook.find({ user: req.user!.id }).sort({ createdAt: -1 }).lean();
  res.json({ items: items.map((h) => ({ id: h._id, url: h.url, events: h.events, active: h.active, failures: h.failures, lastStatus: h.lastStatus ?? null, lastDeliveryAt: h.lastDeliveryAt ?? null })) });
});

r.patch("/webhooks/:id", ...guard, async (req, res) => {
  const d = parse(z.object({ active: z.boolean(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).partial(), req.body);
  const h = await Webhook.findOne({ _id: oid(String(req.params.id)), user: req.user!.id });
  if (!h) throw new HttpError(404, "Not found");
  if (d.events) h.events = [...new Set(d.events)] as any;
  if (d.active !== undefined) {
    h.active = d.active;
    if (d.active) h.failures = 0; // resuming starts the failure count again
  }
  await h.save();
  res.json({ ok: true });
});

r.delete("/webhooks/:id", ...guard, async (req, res) => {
  const h = await Webhook.findOneAndDelete({ _id: oid(String(req.params.id)), user: req.user!.id });
  if (!h) throw new HttpError(404, "Not found");
  res.json({ ok: true });
});

r.post("/webhooks/:id/test", testLimit, ...guard, async (req, res) => {
  const h = await Webhook.findOne({ _id: oid(String(req.params.id)), user: req.user!.id }).lean();
  if (!h) throw new HttpError(404, "Not found");
  res.json(await sendOnce(h, "ping", randomUUID(), { message: "Hello from Idevrx" }));
});

export default r;
