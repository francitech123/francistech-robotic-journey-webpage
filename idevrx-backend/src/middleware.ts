import jwt from "jsonwebtoken";
import { z } from "zod";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { config } from "./config.js";
import { ApiKey, User } from "./models.js";
import { sha256 } from "./tokens.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string; suspended?: boolean; emailVerified?: boolean; viaKey?: { id: string; scope: string } };
    }
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "Invalid input", r.error.flatten());
  return r.data;
};

export const sign = (id: string) => jwt.sign({ sub: id }, config.JWT_SECRET, { expiresIn: "7d" });

async function identify(header?: string) {
  if (!header?.startsWith("Bearer ")) return undefined;
  const raw = header.slice(7);
  try {
    let userId: string;
    let viaKey: { id: string; scope: string } | undefined;
    let iat = 0;
    if (raw.startsWith("idv_")) {
      const k = await ApiKey.findOne({ hash: sha256(raw), revokedAt: { $exists: false } }).lean();
      if (!k) return undefined;
      userId = String(k.user);
      viaKey = { id: String(k._id), scope: k.scope as string };
      if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) void ApiKey.updateOne({ _id: k._id }, { lastUsedAt: new Date() }).exec();
    } else {
      const p = jwt.verify(raw, config.JWT_SECRET) as jwt.JwtPayload;
      userId = String(p.sub);
      iat = p.iat ?? 0;
    }
    const u = await User.findById(userId).select("role suspended emailVerified passwordChangedAt").lean();
    if (!u) return undefined;
    // A password change ends every session issued before it. (API keys are revoked on their own.)
    if (!viaKey && u.passwordChangedAt && iat < Math.floor(u.passwordChangedAt.getTime() / 1000)) return undefined;
    return { id: String(u._id), role: u.role as string, suspended: !!u.suspended, emailVerified: !!u.emailVerified, viaKey };
  } catch {
    return undefined;
  }
}

export const auth: RequestHandler = async (req, _res, next) => {
  const u = await identify(req.headers.authorization);
  if (!u) throw new HttpError(401, "Sign in required");
  if (u.suspended) throw new HttpError(403, "This account is suspended");
  if (u.viaKey?.scope === "read" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) throw new HttpError(403, "This API key is read-only");
  req.user = u;
  next();
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const u = await identify(req.headers.authorization);
  req.user = u && !u.suspended ? u : undefined;
  next();
};

export const requireCreator: RequestHandler = (req, _res, next) => {
  if (!req.user || !["creator", "admin"].includes(req.user.role)) throw new HttpError(403, "Creator access required");
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "admin" || req.user.viaKey) throw new HttpError(403, "Admin access required");
  next();
};

// Account-level actions need a signed-in session, never an API key.
export const sessionOnly: RequestHandler = (req, _res, next) => {
  if (req.user?.viaKey) throw new HttpError(403, "Sign in with your account to do this. API keys can’t.");
  next();
};

export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!config.requireVerifiedEmail || req.user?.role === "admin" || req.user?.emailVerified) {
    next();
    return;
  }
  throw new HttpError(403, "Verify your email address first", { code: "EMAIL_NOT_VERIFIED" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
  } else if (err?.code === 11000) {
    res.status(409).json({ error: "Already exists" });
  } else {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
