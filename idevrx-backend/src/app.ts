import express from "express";
import { fileURLToPath } from "node:url";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { errorHandler, HttpError } from "./middleware.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import projectRoutes from "./routes/projects.js";
import fileRoutes from "./routes/files.js";
import searchRoutes from "./routes/search.js";
import communityRoutes from "./routes/community.js";
import learningRoutes from "./routes/learning.js";
import adminRoutes from "./routes/admin.js";
import developerRoutes from "./routes/developer.js";

const storageOrigin = (() => {
  try { return new URL(config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT ?? "").origin; } catch { return undefined; }
})();
const storageSrc = storageOrigin ? [storageOrigin] : [];

export const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"], // the UI has an inline script; move it to a file to drop this
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:", "https:", ...storageSrc],
        "connect-src": ["'self'", "https:", ...storageSrc], // tighten to your storage origin in production
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
  })
);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
app.use(cors({ origin: config.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

app.get("/api/health", (_req, res) => void res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/learning", learningRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", developerRoutes);
app.use("/api", communityRoutes);
app.use("/api", fileRoutes);

app.use(() => {
  throw new HttpError(404, "Not found");
});
app.use(errorHandler);
