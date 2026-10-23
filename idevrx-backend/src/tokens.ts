import { createHash, randomBytes } from "node:crypto";
import { Token } from "./models.js";

type TokenType = "verify" | "reset" | "email";

// Only a hash of each token is stored, so a database leak can't be used to reset accounts.
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export const sha256 = hash;

// For "email" tokens, `email` is the new address being confirmed.
export async function issueToken(user: unknown, type: TokenType, ttlMs: number, email?: string) {
  await Token.deleteMany({ user, type, usedAt: { $exists: false } }); // one live token per purpose
  const token = randomBytes(32).toString("hex");
  await Token.create({ user, type, email, hash: hash(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

// Single use, enforced atomically. Returns the token record, or null if it is wrong, used or expired.
export async function takeToken(token: string, type: TokenType) {
  return Token.findOneAndUpdate(
    { hash: hash(token), type, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() }
  );
}

export async function consumeToken(token: string, type: TokenType) {
  const t = await takeToken(token, type);
  return t ? t.user : null;
}
