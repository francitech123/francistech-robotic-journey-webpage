import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User, Token } from "../models.js";
import { config } from "../config.js";
import { sendMail } from "../mail.js";
import { issueToken, consumeToken, takeToken } from "../tokens.js";
import { auth, sessionOnly, parse, sign, HttpError } from "../middleware.js";

const r = Router();
const limiter = () => rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

async function sendVerification(u: { _id: unknown; email: string; displayName: string }) {
  const token = await issueToken(u._id, "verify", 24 * 60 * 60 * 1000);
  await sendMail({
    to: u.email,
    subject: "Verify your Idevrx email",
    text: `Hi ${u.displayName},\n\nConfirm your email address to finish setting up your Idevrx account:\n\n${config.APP_URL}/#verify-${token}\n\nThe link works for 24 hours. If you didn’t create this account, ignore this email.\n`,
  });
}
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12); // equalises timing for unknown users

const present = (u: any) => ({ id: String(u._id), username: u.username, displayName: u.displayName, role: u.role, emailVerified: !!u.emailVerified });

r.post("/register", async (req, res) => {
  const d = parse(
    z.object({
      username: z.string().regex(/^[a-zA-Z0-9_-]{3,24}$/, "3-24 letters, numbers, _ or -"),
      email: z.string().email().max(200),
      password: z.string().min(8).max(128),
      displayName: z.string().trim().min(1).max(60).optional(),
    }),
    req.body
  );
  const u = await User.create({
    username: d.username,
    email: d.email,
    displayName: d.displayName ?? d.username,
    passwordHash: await bcrypt.hash(d.password, 12),
  });
  try {
    await sendVerification(u);
  } catch (e) {
    console.error("verification email failed", e); // sign-up still succeeds; the user can resend
  }
  res.status(201).json({ token: sign(String(u._id)), user: present(u) });
});

r.post("/login", async (req, res) => {
  const d = parse(z.object({ identifier: z.string().max(200), password: z.string().max(128) }), req.body);
  const id = d.identifier.toLowerCase();
  const u = await User.findOne({ $or: [{ email: id }, { username: id }] });
  const ok = await bcrypt.compare(d.password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Wrong email, username or password");
  if (u.suspended) throw new HttpError(403, "This account is suspended");
  res.json({ token: sign(String(u._id)), user: present(u) });
});

r.get("/me", auth, async (req, res) => {
  const u = await User.findById(req.user!.id).lean();
  if (!u) throw new HttpError(401, "Sign in required");
  res.json({ user: present(u) });
});

r.post("/verify-email", async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
  const uid = await consumeToken(token, "verify");
  if (!uid) throw new HttpError(400, "This link is invalid or has expired");
  await User.updateOne({ _id: uid }, { emailVerified: true });
  res.json({ ok: true });
});

r.post("/resend-verification", limiter(), auth, async (req, res) => {
  const u = await User.findById(req.user!.id);
  if (!u) throw new HttpError(401, "Sign in required");
  if (u.emailVerified) {
    res.json({ verified: true });
    return;
  }
  await sendVerification(u);
  res.json({ sent: true });
});

// Always answers the same way, so nobody can use this form to find out which emails have accounts.
r.post("/forgot-password", limiter(), async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email().max(200) }), req.body);
  res.json({ ok: true });
  void (async () => {
    const u = await User.findOne({ email: email.toLowerCase() });
    if (!u || u.suspended) return;
    const token = await issueToken(u._id, "reset", 60 * 60 * 1000);
    await sendMail({
      to: u.email,
      subject: "Reset your Idevrx password",
      text: `Hi ${u.displayName},\n\nChoose a new password for your Idevrx account:\n\n${config.APP_URL}/#reset-${token}\n\nThe link works for one hour and only once. If you didn’t ask for this, ignore this email. Your password stays the same.\n`,
    });
  })().catch((e) => console.error("password reset email failed", e));
});

r.post("/reset-password", async (req, res) => {
  const d = parse(z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) }), req.body);
  const uid = await consumeToken(d.token, "reset");
  if (!uid) throw new HttpError(400, "This link is invalid or has expired");
  // A reset link proves control of the inbox, so it also verifies the email. Old sessions end.
  await User.updateOne({ _id: uid }, { passwordHash: await bcrypt.hash(d.password, 12), passwordChangedAt: new Date(), emailVerified: true });
  await Token.deleteMany({ user: uid, type: "reset" });
  res.json({ ok: true });
});

// ---- Settings: change password and email while signed in
r.post("/change-password", limiter(), auth, sessionOnly, async (req, res) => {
  const d = parse(z.object({ currentPassword: z.string().max(128), newPassword: z.string().min(8).max(128) }), req.body);
  const u = await User.findById(req.user!.id);
  if (!u || !(await bcrypt.compare(d.currentPassword, u.passwordHash))) throw new HttpError(403, "Current password is wrong");
  u.passwordHash = await bcrypt.hash(d.newPassword, 12);
  u.passwordChangedAt = new Date(); // signs out every other session
  await u.save();
  await Token.deleteMany({ user: u._id, type: "reset" });
  res.json({ token: sign(String(u._id)) }); // this device stays signed in
});

// The new address is only used after its owner clicks the link. Answers the same whether or not the
// address is free, so it can't be used to look up other people's emails.
r.post("/change-email", limiter(), auth, sessionOnly, async (req, res) => {
  const d = parse(z.object({ email: z.string().email().max(200), password: z.string().max(128) }), req.body);
  const u = await User.findById(req.user!.id);
  if (!u || !(await bcrypt.compare(d.password, u.passwordHash))) throw new HttpError(403, "Password is wrong");
  const email = d.email.toLowerCase();
  if (email !== u.email && !(await User.exists({ email }))) {
    const token = await issueToken(u._id, "email", 60 * 60 * 1000, email);
    await sendMail({
      to: email,
      subject: "Confirm your new Idevrx email",
      text: `Hi ${u.displayName},\n\nConfirm this address as the email for your Idevrx account:\n\n${config.APP_URL}/#confirm-email-${token}\n\nThe link works for one hour. If you didn’t ask for this, ignore this email.\n`,
    });
  }
  res.json({ ok: true });
});

r.post("/confirm-email-change", async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
  const t = await takeToken(token, "email");
  const u = t?.email ? await User.findById(t.user) : null;
  if (!t || !t.email || !u) throw new HttpError(400, "This link is invalid or has expired");
  const old = u.email;
  try {
    u.email = t.email;
    u.emailVerified = true;
    await u.save();
  } catch (e: any) {
    if (e?.code === 11000) throw new HttpError(409, "That address is already in use");
    throw e;
  }
  try {
    await sendMail({
      to: old,
      subject: "Your Idevrx email was changed",
      text: `Hi ${u.displayName},\n\nThe email address on your Idevrx account was changed to ${t.email}. If this wasn’t you, reset your password straight away.\n`,
    });
  } catch (e) {
    console.error("email-change notice failed", e);
  }
  res.json({ ok: true });
});

export default r;
