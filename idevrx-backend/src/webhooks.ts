import { randomUUID } from "node:crypto";
import { Webhook } from "./models.js";
import { postJson, signPayload, validateWebhookUrl } from "./net.js";

export type EventName = "project.published" | "comment.created" | "user.followed" | "ping";

const RETRY_DELAYS_MS = [0, 2000, 15000]; // one try, then two retries
const PAUSE_AFTER_FAILURES = 10;

// One delivery attempt. The address is validated again here, and the transport refuses private addresses.
export async function sendOnce(hook: { url: string; secret: string }, event: EventName, deliveryId: string, data: unknown) {
  const bad = validateWebhookUrl(hook.url);
  if (bad) return { ok: false, status: bad };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id: deliveryId, event, createdAt: new Date().toISOString(), data });
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Idevrx-Webhooks/1",
    "X-Idevrx-Event": event,
    "X-Idevrx-Delivery": deliveryId,
    "X-Idevrx-Timestamp": timestamp,
    "X-Idevrx-Signature": signPayload(hook.secret, timestamp, body),
  };
  try {
    const r = await postJson(hook.url, body, headers);
    return { ok: r.status >= 200 && r.status < 300, status: r.status as number | string };
  } catch (e: any) {
    return { ok: false, status: (e?.message ?? "Request failed") as number | string };
  }
}

async function run(hook: any, event: EventName, data: unknown) {
  const id = randomUUID(); // the same id on every retry, so receivers can de-duplicate
  let last: { ok: boolean; status: number | string } = { ok: false, status: "not sent" };
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    last = await sendOnce(hook, event, id, data);
    if (last.ok) break;
  }
  const update: Record<string, unknown> = { lastStatus: String(last.status), lastDeliveryAt: new Date() };
  const w = await Webhook.findByIdAndUpdate(hook._id, last.ok ? { ...update, failures: 0 } : { ...update, $inc: { failures: 1 } }, { new: true });
  if (!last.ok && w && w.failures >= PAUSE_AFTER_FAILURES) await Webhook.updateOne({ _id: w._id }, { active: false });
}

// Fire and forget: never slows down or fails the request that caused the event.
export function emitEvent(userId: unknown, event: Exclude<EventName, "ping">, data: unknown) {
  void (async () => {
    const hooks = await Webhook.find({ user: userId, active: true, events: event }).lean();
    for (const h of hooks) void run(h, event, data).catch((e) => console.error("webhook delivery failed", e));
  })().catch((e) => console.error("webhook emit failed", e));
}
