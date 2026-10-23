import "dotenv/config";
import { z } from "zod";

const env = z
  .object({
    PORT: z.coerce.number().default(4000),
    MONGODB_URI: z.string().min(1),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    CREATOR_AUTO_APPROVE: z.enum(["true", "false"]).default("true"),
    REQUIRE_VERIFIED_EMAIL: z.enum(["true", "false"]).default("false"),
    APP_URL: z.string().default("http://localhost:4000"), // used in email links
    SMTP_URL: z.string().optional(), // e.g. smtp://user:pass@host:587. Empty: emails are printed to the console.
    MAIL_FROM: z.string().default("Idevrx <no-reply@idevrx.local>"),
    S3_ENDPOINT: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(), // address the browser can reach, if different
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    PUBLIC_MEDIA_BASE_URL: z.string().optional(),
  })
  .parse(process.env);

export const config = {
  ...env,
  S3_ENDPOINT: env.S3_ENDPOINT || undefined,
  S3_PUBLIC_ENDPOINT: env.S3_PUBLIC_ENDPOINT || undefined,
  PUBLIC_MEDIA_BASE_URL: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") || undefined,
  creatorAutoApprove: env.CREATOR_AUTO_APPROVE === "true",
  requireVerifiedEmail: env.REQUIRE_VERIFIED_EMAIL === "true",
  APP_URL: env.APP_URL.replace(/\/$/, ""),
  SMTP_URL: env.SMTP_URL || undefined,
};
