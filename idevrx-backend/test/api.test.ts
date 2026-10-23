import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Email is captured instead of sent.
const mails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("../src/mail.js", () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => void mails.push(m) }));

// Outbound webhook requests are captured instead of sent.
const hookCalls = vi.hoisted(() => [] as { url: string; body: string; headers: Record<string, string> }[]);
vi.mock("../src/net.js", async (orig) => ({
  ...(await orig<typeof import("../src/net.js")>()),
  postJson: async (url: string, body: string, headers: Record<string, string>) => {
    hookCalls.push({ url, body, headers });
    return { status: 200 };
  },
}));

// Storage is faked: signed URLs are plain strings, and "head" reports the size that was declared at presign time.
const sizes = vi.hoisted(() => new Map<string, number>());
vi.mock("../src/storage.js", () => ({
  signedPut: async (key: string, _type: string, size: number) => {
    sizes.set(key, size);
    return `http://storage.test/put/${key}`;
  },
  signedGet: async (key: string) => `http://storage.test/get/${key}`,
  mediaUrl: async (key: string) => `http://storage.test/media/${key}`,
  head: async (key: string) => (sizes.has(key) ? { size: sizes.get(key)! } : null),
  remove: async () => {},
  getBytes: async () => Buffer.from("void setup() {}\n"),
}));

import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { User, LearningPath, Lesson } from "../src/models.js";

const api = request(app);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const signup = (username: string) =>
  api.post("/api/auth/register").send({ username, email: `${username}@test.dev`, password: "password123" });

const DRAFT = {
  title: "Arduino RFID Smart Lock",
  description: "Opens a door with an RFID card.",
  category: "Electronics",
  difficulty: 1,
  buildTime: "4-6 hrs",
  cost: "65000",
  tags: ["Arduino", "RFID"],
  controller: "Arduino UNO",
  language: "C++",
  components: [{ name: "Arduino UNO", qty: 1, spec: "5V" }],
  steps: ["Wire the RFID reader", "Upload the sketch"],
  youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
};

describe("Idevrx API", () => {
  let mongod: MongoMemoryServer;
  const token: Record<string, string> = {};
  let projectId = "";

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await mongoose.syncIndexes(); // unique project numbers and the text indexes
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("serves the health check, the UI and JSON 404s", async () => {
    expect((await api.get("/api/health")).body).toEqual({ ok: true });
    const page = await api.get("/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["content-security-policy"]).toBeDefined();
    const missing = await api.get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Not found");
  });

  describe("auth", () => {
    it("registers, rejects duplicates and weak passwords", async () => {
      const a = await signup("ana");
      expect(a.status).toBe(201);
      expect(a.body.user.role).toBe("user");
      token.ana = a.body.token;
      expect((await signup("ana")).status).toBe(409);
      const weak = await api.post("/api/auth/register").send({ username: "weak", email: "w@test.dev", password: "short" });
      expect(weak.status).toBe(400);
    });

    it("logs in with email, rejects a wrong password, and returns the current user", async () => {
      const bad = await api.post("/api/auth/login").send({ identifier: "ana@test.dev", password: "wrong-password" });
      expect(bad.status).toBe(401);
      const ok = await api.post("/api/auth/login").send({ identifier: "ana@test.dev", password: "password123" });
      expect(ok.status).toBe(200);
      const me = await api.get("/api/auth/me").set(bearer(ok.body.token));
      expect(me.body.user.username).toBe("ana");
      expect((await api.get("/api/auth/me")).status).toBe(401);
    });

    it("only lets creators create projects", async () => {
      expect((await api.post("/api/projects").set(bearer(token.ana)).send({ title: "x" })).status).toBe(403);
      const up = await api.post("/api/users/me/become-creator").set(bearer(token.ana));
      expect(up.body.role).toBe("creator");
    });
  });

  describe("publishing", () => {
    it("blocks publishing until the project check passes", async () => {
      const created = await api.post("/api/projects").set(bearer(token.ana)).send(DRAFT);
      expect(created.status).toBe(201);
      projectId = created.body.id;
      const early = await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({});
      expect(early.status).toBe(422);
      expect(early.body.details.missing).toEqual(expect.arrayContaining(["Cover image", "Files"]));
    });

    it("rejects an invalid YouTube link", async () => {
      const r = await api.patch(`/api/projects/${projectId}`).set(bearer(token.ana)).send({ youtubeUrl: "https://example.com/x" });
      expect(r.status).toBe(400);
    });

    it("validates uploads: allowlist and size", async () => {
      const presign = (body: object) => api.post(`/api/projects/${projectId}/files/presign`).set(bearer(token.ana)).send(body);
      expect((await presign({ filename: "setup.exe", size: 100, contentType: "application/octet-stream" })).status).toBe(400);
      expect((await presign({ filename: "page.html", size: 100, contentType: "text/html" })).status).toBe(400);
      expect((await presign({ filename: "big.zip", size: 21 * 1024 * 1024, contentType: "application/zip" })).status).toBe(400);
      expect((await presign({ filename: "cover.svg", size: 100, contentType: "image/svg+xml", kind: "cover" })).status).toBe(400);
    });

    it("uploads a cover and a file, then publishes as project 001 v1.0", async () => {
      const presign = (body: object) => api.post(`/api/projects/${projectId}/files/presign`).set(bearer(token.ana)).send(body);
      const cover = await presign({ filename: "cover.png", size: 1000, contentType: "image/png", kind: "cover" });
      expect(cover.status).toBe(201);
      expect(cover.body.uploadUrl).toContain("http://storage.test/put/");
      expect((await api.post(`/api/files/${cover.body.fileId}/confirm`).set(bearer(token.ana))).status).toBe(200);

      const zip = await presign({ filename: "lock.zip", size: 2048, contentType: "application/zip" });
      expect((await api.post(`/api/files/${zip.body.fileId}/confirm`).set(bearer(token.ana))).status).toBe(200);

      const pub = await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({});
      expect(pub.status).toBe(200);
      expect(pub.body).toMatchObject({ number: "001", version: "1.0", slug: "arduino-rfid-smart-lock" });
    });

    it("shows the public page with files, cover and no pending data", async () => {
      const r = await api.get("/api/projects/001");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ title: DRAFT.title, creator: "ana", youtubeId: "dQw4w9WgXcQ", likes: 0 });
      expect(r.body.files).toHaveLength(1);
      expect(r.body.cover).toContain("http://storage.test/media/");
      expect(r.body.pending).toBeUndefined();
    });

    it("keeps edits to a published project pending until the next publish", async () => {
      const edit = await api.patch(`/api/projects/${projectId}`).set(bearer(token.ana)).send({ title: "Arduino RFID Smart Lock v2" });
      expect(edit.body.status).toBe("PUBLISHED");
      expect((await api.get("/api/projects/001")).body.title).toBe(DRAFT.title);
      const owner = await api.get("/api/projects/001").set(bearer(token.ana));
      expect(owner.body.title).toBe("Arduino RFID Smart Lock v2");
      expect(owner.body.hasPendingChanges).toBe(true);

      const pub = await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({ note: "Added keypad" });
      expect(pub.body.version).toBe("1.1");
      const live = await api.get("/api/projects/001");
      expect(live.body.title).toBe("Arduino RFID Smart Lock v2");
      expect(live.body.history).toHaveLength(2);
      expect(live.body.history[1].note).toBe("Added keypad");
    });

    it("keeps drafts private and refuses to delete a published project", async () => {
      const hidden = await api.post("/api/projects").set(bearer(token.ana)).send({ title: "Hidden draft" });
      expect((await api.get(`/api/projects/${hidden.body.id}`)).status).toBe(404);
      const list = await api.get("/api/projects");
      expect(list.body.items.map((p: any) => p.title)).not.toContain("Hidden draft");
      expect((await api.delete(`/api/projects/${projectId}`).set(bearer(token.ana))).status).toBe(409);
      expect((await api.delete(`/api/projects/${hidden.body.id}`).set(bearer(token.ana))).status).toBe(200);
    });

    it("unpublishes and republishes without changing the project number", async () => {
      await api.post(`/api/projects/${projectId}/unpublish`).set(bearer(token.ana));
      expect((await api.get("/api/projects/001")).status).toBe(404);
      const again = await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({});
      expect(again.body).toMatchObject({ number: "001", version: "1.2" });
    });
  });

  describe("browse and search", () => {
    it("lists, filters and searches published projects", async () => {
      expect((await api.get("/api/projects?category=Electronics")).body.total).toBe(1);
      expect((await api.get("/api/search?q=rfid")).body.items[0].number).toBe("001");
      expect((await api.get("/api/search?q=rfid&difficulty=3")).body.total).toBe(0);
      expect((await api.get("/api/search?category=Nope")).status).toBe(400);
    });
  });

  describe("community", () => {
    it("likes and saves idempotently", async () => {
      token.bob = (await signup("bob")).body.token;
      expect((await api.put("/api/projects/001/like")).status).toBe(401);
      const like = () => api.put("/api/projects/001/like").set(bearer(token.bob));
      expect((await like()).body).toEqual({ liked: true, count: 1 });
      expect((await like()).body.count).toBe(1);
      const page = await api.get("/api/projects/001").set(bearer(token.bob));
      expect(page.body.viewer.liked).toBe(true);
      expect((await api.delete("/api/projects/001/like").set(bearer(token.bob))).body).toEqual({ liked: false, count: 0 });

      expect((await api.put("/api/projects/001/save").set(bearer(token.bob))).body.count).toBe(1);
      expect((await api.get("/api/me/saved").set(bearer(token.bob))).body.items).toHaveLength(1);
    });

    it("supports comments, replies, notifications and permissions", async () => {
      token.cy = (await signup("cy")).body.token;
      const post = (body: object) => api.post("/api/projects/001/comments").set(bearer(token.bob)).send(body);
      expect((await post({ body: "What servo did you use?" })).status).toBe(201);

      const first = await api.get("/api/projects/001/comments");
      const topId = first.body.items[0].id;
      const reply = await api.post("/api/projects/001/comments").set(bearer(token.ana)).send({ body: "MG996R.", parent: topId });
      expect(reply.status).toBe(201);

      const anaNotes = await api.get("/api/notifications").set(bearer(token.ana));
      expect(anaNotes.body.items[0]).toMatchObject({ type: "comment", actor: "bob" });
      const bobNotes = await api.get("/api/notifications").set(bearer(token.bob));
      expect(bobNotes.body.items[0]).toMatchObject({ type: "reply", actor: "ana" });

      const all = await api.get("/api/projects/001/comments");
      expect(all.body.items).toHaveLength(2);
      expect(all.body.items[1].parent).toBe(topId);
      expect((await api.get("/api/projects/001")).body.commentCount).toBe(2);

      expect((await api.delete(`/api/comments/${topId}`).set(bearer(token.cy))).status).toBe(403);
      expect((await api.delete(`/api/comments/${topId}`).set(bearer(token.bob))).status).toBe(200);
      expect((await api.get("/api/projects/001")).body.commentCount).toBe(0);

      await api.post("/api/notifications/read").set(bearer(token.ana));
      expect((await api.get("/api/notifications").set(bearer(token.ana))).body.unread).toBe(0);
    });

    it("follows creators, blocks self-follow, and builds a feed", async () => {
      const follow = () => api.put("/api/users/ana/follow").set(bearer(token.bob));
      expect((await follow()).body).toEqual({ following: true, followers: 1 });
      expect((await follow()).body.followers).toBe(1);
      const profile = await api.get("/api/users/ana").set(bearer(token.bob));
      expect(profile.body).toMatchObject({ followers: 1, viewer: { following: true } });
      expect((await api.put("/api/users/ana/follow").set(bearer(token.ana))).status).toBe(400);
      const feed = await api.get("/api/feed").set(bearer(token.bob));
      expect(feed.body.items[0].number).toBe("001");
    });
  });

  describe("BOM, viewers, versions and forks", () => {
    it("exports the bill of materials as CSV", async () => {
      const r = await api.get("/api/projects/001/bom.csv");
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("text/csv");
      expect(r.text).toContain('"Component","Quantity","Specification"');
      expect(r.text).toContain('"Arduino UNO","1","5V"');
      expect((await api.get("/api/projects/999/bom.csv")).status).toBe(404);
    });

    it("previews source and STL files, and refuses other types and large files", async () => {
      const upload = async (filename: string, size: number) => {
        const p = await api.post(`/api/projects/${projectId}/files/presign`).set(bearer(token.ana)).send({ filename, size, contentType: "application/octet-stream" });
        await api.post(`/api/files/${p.body.fileId}/confirm`).set(bearer(token.ana));
        return p.body.fileId as string;
      };
      const ino = await upload("lock.ino", 120);
      const src = await api.get(`/api/files/${ino}/content`);
      expect(src.status).toBe(200);
      expect(src.text).toContain("void setup()");
      expect((await api.get(`/api/files/${await upload("case.stl", 500)}/content`)).headers["content-type"]).toContain("application/octet-stream");
      expect((await api.get(`/api/files/${await upload("extra.zip", 500)}/content`)).status).toBe(415);
      expect((await api.get(`/api/files/${await upload("big.ino", 300 * 1024)}/content`)).status).toBe(413);
    });

    it("compares two versions", async () => {
      const cmp = (q: string) => api.get(`/api/projects/001/compare?${q}`);
      const a = await cmp("from=1.0&to=1.1");
      expect(a.status).toBe(200);
      expect(a.body.identical).toBe(false);
      expect(a.body.changes).toEqual(expect.arrayContaining([{ field: "title", from: DRAFT.title, to: "Arduino RFID Smart Lock v2" }]));
      expect((await cmp("from=1.1&to=1.2")).body.identical).toBe(true);
      expect((await cmp("from=1.0&to=9.9")).status).toBe(404);
      expect((await cmp("from=x&to=1.1")).status).toBe(400);
    });

    it("forks into an attributed draft that publishes as 001-F1", async () => {
      await api.post("/api/users/me/become-creator").set(bearer(token.bob));
      const fork = await api.post("/api/projects/001/fork").set(bearer(token.bob));
      expect(fork.status).toBe(201);
      const forkId = fork.body.id;
      expect((await api.get(`/api/projects/${forkId}`)).status).toBe(404);
      const mine = await api.get(`/api/projects/${forkId}`).set(bearer(token.bob));
      expect(mine.body).toMatchObject({ title: "Arduino RFID Smart Lock v2 (fork)", forkOfNumber: "001", forkOfCreator: "ana", creator: "bob" });
      expect(mine.body.files).toEqual([]);
      expect((await api.post(`/api/projects/${forkId}/publish`).set(bearer(token.bob)).send({})).status).toBe(422);

      const presign = (body: object) => api.post(`/api/projects/${forkId}/files/presign`).set(bearer(token.bob)).send(body);
      const cover = await presign({ filename: "mine.png", size: 900, contentType: "image/png", kind: "cover" });
      await api.post(`/api/files/${cover.body.fileId}/confirm`).set(bearer(token.bob));
      const zip = await presign({ filename: "mine.zip", size: 900, contentType: "application/zip" });
      await api.post(`/api/files/${zip.body.fileId}/confirm`).set(bearer(token.bob));

      const pub = await api.post(`/api/projects/${forkId}/publish`).set(bearer(token.bob)).send({});
      expect(pub.body.number).toBe("001-F1");
      expect((await api.get("/api/projects/001-F1")).body.forkOfCreator).toBe("ana");
      expect((await api.get("/api/projects/001")).body.forkCount).toBe(1);
    });

    it("lets a creator turn forking off and on immediately", async () => {
      const set = (allowForks: boolean) => api.patch(`/api/projects/${projectId}`).set(bearer(token.ana)).send({ allowForks });
      expect((await set(false)).status).toBe(200);
      expect((await api.post("/api/projects/001/fork").set(bearer(token.bob))).status).toBe(403);
      expect((await api.get("/api/projects/001").set(bearer(token.ana))).body.hasPendingChanges).toBe(false);
      await set(true);
    });
  });

  describe("moderation", () => {
    it("lets signed-in users report a project once", async () => {
      await User.updateOne({ username: "cy" }, { role: "admin" });
      const send = (body: object) => api.post("/api/reports").set(bearer(token.bob)).send(body);
      expect((await api.post("/api/reports").send({ type: "project", target: "001", reason: "spam" })).status).toBe(401);
      expect((await send({ type: "project", target: "001", reason: "boring" })).status).toBe(400);
      expect((await send({ type: "project", target: "001", reason: "spam", details: "Looks like an ad" })).status).toBe(201);
      expect((await send({ type: "project", target: "001", reason: "spam" })).status).toBe(409);
      expect((await send({ type: "project", target: "999", reason: "spam" })).status).toBe(404);
    });

    it("shows reports to admins only and lets them close them", async () => {
      expect((await api.get("/api/admin/reports").set(bearer(token.bob))).status).toBe(403);
      const list = await api.get("/api/admin/reports").set(bearer(token.cy));
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ type: "project", reason: "spam", reporter: "bob", projectNumber: "001" });
      const patch = await api.patch(`/api/admin/reports/${list.body.items[0].id}`).set(bearer(token.cy)).send({ status: "dismissed" });
      expect(patch.status).toBe(200);
      expect((await api.get("/api/admin/reports").set(bearer(token.cy))).body.items).toHaveLength(0);
    });

    it("features and unfeatures a project and tells the creator", async () => {
      const found = await api.get("/api/admin/projects?q=rfid").set(bearer(token.cy));
      const id = found.body.items.find((p: any) => p.number === "001").id;
      expect((await api.put(`/api/admin/projects/${id}/feature`).set(bearer(token.cy))).status).toBe(200);
      expect((await api.get("/api/projects?featured=1")).body.total).toBe(1);
      const notes = await api.get("/api/notifications").set(bearer(token.ana));
      expect(notes.body.items[0]).toMatchObject({ type: "featured", projectNumber: "001" });
      expect((await api.delete(`/api/admin/projects/${id}/feature`).set(bearer(token.cy))).status).toBe(200);
      expect((await api.get("/api/projects?featured=1")).body.total).toBe(0);
    });

    it("unpublishes with a note that reaches the creator, who can republish", async () => {
      const found = await api.get("/api/admin/projects?q=rfid").set(bearer(token.cy));
      const id = found.body.items.find((p: any) => p.number === "001").id;
      expect((await api.post(`/api/admin/projects/${id}/unpublish`).set(bearer(token.bob)).send({})).status).toBe(403);
      expect((await api.post(`/api/admin/projects/${id}/unpublish`).set(bearer(token.cy)).send({ note: "Unsafe wiring" })).status).toBe(200);
      expect((await api.get("/api/projects/001")).status).toBe(404);
      const notes = await api.get("/api/notifications").set(bearer(token.ana));
      expect(notes.body.items[0]).toMatchObject({ type: "moderation", message: "Unsafe wiring" });
      expect((await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({})).status).toBe(200);
      expect((await api.get("/api/projects/001")).status).toBe(200);
    });

    it("suspends and restores accounts and protects admins", async () => {
      const bobId = (await api.get("/api/admin/users?q=bob").set(bearer(token.cy))).body.items[0].id;
      const suspend = (id: string, suspended: boolean) => api.patch(`/api/admin/users/${id}/suspend`).set(bearer(token.cy)).send({ suspended });
      expect((await suspend(bobId, true)).status).toBe(200);
      expect((await api.get("/api/auth/me").set(bearer(token.bob))).status).toBe(403);
      expect((await api.post("/api/auth/login").send({ identifier: "bob@test.dev", password: "password123" })).status).toBe(403);
      await suspend(bobId, false);
      expect((await api.get("/api/auth/me").set(bearer(token.bob))).status).toBe(200);
      const cyId = (await api.get("/api/admin/users?q=cy").set(bearer(token.cy))).body.items[0].id;
      expect((await suspend(cyId, true)).status).toBe(400);
    });
  });

  describe("email verification and password reset", () => {
    const linkToken = (kind: string) => {
      const m = [...mails].reverse().find((x) => x.text.includes(`#${kind}-`));
      return m!.text.match(new RegExp(`#${kind}-([a-f0-9]+)`))![1];
    };

    it("sends a verification link on sign-up that works once", async () => {
      const dan = await signup("dan");
      expect(dan.body.user.emailVerified).toBe(false);
      expect(mails.at(-1)).toMatchObject({ to: "dan@test.dev", subject: "Verify your Idevrx email" });
      token.dan = dan.body.token;
      expect((await api.post("/api/auth/verify-email").send({ token: "x".repeat(64) })).status).toBe(400);
      const t = linkToken("verify");
      expect((await api.post("/api/auth/verify-email").send({ token: t })).status).toBe(200);
      expect((await api.get("/api/auth/me").set(bearer(token.dan))).body.user.emailVerified).toBe(true);
      expect((await api.post("/api/auth/verify-email").send({ token: t })).status).toBe(400);
    });

    it("requires a verified email for creators, publishing and comments when enabled", async () => {
      config.requireVerifiedEmail = true;
      try {
        const eve = await signup("eve");
        const up = await api.post("/api/users/me/become-creator").set(bearer(eve.body.token));
        expect(up.status).toBe(403);
        expect(up.body.details).toEqual({ code: "EMAIL_NOT_VERIFIED" });
        expect((await api.post("/api/projects/001/comments").set(bearer(eve.body.token)).send({ body: "hi" })).status).toBe(403);
        expect((await api.post("/api/users/me/become-creator").set(bearer(token.dan))).status).toBe(200);

        expect((await api.post("/api/auth/resend-verification").set(bearer(token.dan))).body).toEqual({ verified: true });
        const before = mails.length;
        expect((await api.post("/api/auth/resend-verification").set(bearer(eve.body.token))).body).toEqual({ sent: true });
        expect(mails.length).toBe(before + 1);
      } finally {
        config.requireVerifiedEmail = false;
      }
    });

    it("resets a forgotten password with a single-use link and ends old sessions", async () => {
      const before = mails.length;
      const unknown = await api.post("/api/auth/forgot-password").send({ email: "nobody@test.dev" });
      expect(unknown.body).toEqual({ ok: true }); // same answer either way: no account enumeration
      expect((await api.post("/api/auth/forgot-password").send({ email: "dan@test.dev" })).body).toEqual({ ok: true });
      await vi.waitFor(() => expect(mails.length).toBe(before + 1));
      expect(mails.at(-1)).toMatchObject({ to: "dan@test.dev", subject: "Reset your Idevrx password" });

      const t = linkToken("reset");
      expect((await api.post("/api/auth/reset-password").send({ token: t, password: "short" })).status).toBe(400);
      await new Promise((r) => setTimeout(r, 1100)); // session tokens have one-second resolution
      expect((await api.post("/api/auth/reset-password").send({ token: t, password: "new-password-1" })).status).toBe(200);
      expect((await api.post("/api/auth/reset-password").send({ token: t, password: "new-password-2" })).status).toBe(400);

      expect((await api.get("/api/auth/me").set(bearer(token.dan))).status).toBe(401);
      expect((await api.post("/api/auth/login").send({ identifier: "dan@test.dev", password: "password123" })).status).toBe(401);
      expect((await api.post("/api/auth/login").send({ identifier: "dan@test.dev", password: "new-password-1" })).status).toBe(200);
    });
  });

  describe("settings", () => {
    let session = "";

    it("shows and updates the profile", async () => {
      session = (await api.post("/api/auth/login").send({ identifier: "dan@test.dev", password: "new-password-1" })).body.token;
      const me = await api.get("/api/users/me").set(bearer(session));
      expect(me.body).toMatchObject({ username: "dan", email: "dan@test.dev", emailVerified: true });
      expect((await api.get("/api/users/me")).status).toBe(401);
      expect((await api.patch("/api/users/me").set(bearer(session)).send({ displayName: "Dan the Builder", bio: "Servo fan." })).status).toBe(200);
      expect((await api.get("/api/users/dan")).body).toMatchObject({ displayName: "Dan the Builder", bio: "Servo fan." });
    });

    it("changes the password, keeps this session and ends the others", async () => {
      const change = (currentPassword: string, newPassword: string) => api.post("/api/auth/change-password").set(bearer(session)).send({ currentPassword, newPassword });
      expect((await change("not-the-password", "third-password-1")).status).toBe(403);
      expect((await change("new-password-1", "short")).status).toBe(400);
      await new Promise((r) => setTimeout(r, 1100)); // session tokens have one-second resolution
      const ok = await change("new-password-1", "third-password-1");
      expect(ok.status).toBe(200);
      expect((await api.get("/api/auth/me").set(bearer(session))).status).toBe(401); // the old token is dead
      expect((await api.get("/api/auth/me").set(bearer(ok.body.token))).status).toBe(200);
      session = ok.body.token;
    });

    it("changes the email only after the new address confirms", async () => {
      const request = (email: string, password: string) => api.post("/api/auth/change-email").set(bearer(session)).send({ email, password });
      expect((await request("dan2@test.dev", "wrong-password")).status).toBe(403);

      const before = mails.length;
      expect((await request("ana@test.dev", "third-password-1")).body).toEqual({ ok: true }); // taken: same answer, no email
      expect(mails.length).toBe(before);

      expect((await request("dan2@test.dev", "third-password-1")).body).toEqual({ ok: true });
      expect(mails.at(-1)).toMatchObject({ to: "dan2@test.dev", subject: "Confirm your new Idevrx email" });
      expect((await api.get("/api/users/me").set(bearer(session))).body.email).toBe("dan@test.dev"); // not yet

      const m = mails.at(-1)!.text.match(/#confirm-email-([a-f0-9]+)/)![1];
      expect((await api.post("/api/auth/confirm-email-change").send({ token: m })).status).toBe(200);
      expect(mails.at(-1)).toMatchObject({ to: "dan@test.dev", subject: "Your Idevrx email was changed" }); // old address is told
      expect((await api.post("/api/auth/confirm-email-change").send({ token: m })).status).toBe(400); // single use
      expect((await api.get("/api/users/me").set(bearer(session))).body.email).toBe("dan2@test.dev");

      expect((await api.post("/api/auth/login").send({ identifier: "dan2@test.dev", password: "third-password-1" })).status).toBe(200);
      expect((await api.post("/api/auth/login").send({ identifier: "dan@test.dev", password: "third-password-1" })).status).toBe(401);
    });
  });

  describe("developer tools", () => {
    let readKey = "", writeKey = "", writeKeyId = "", hookId = "", hookSecret = "";
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it("makes keys that are shown once and never listed in full", async () => {
      const make = (name: string, scope: string) => api.post("/api/keys").set(bearer(token.ana)).send({ name, scope });
      const r = await make("ci", "read");
      expect(r.status).toBe(201);
      expect(r.body.key).toMatch(/^idv_[A-Za-z0-9_-]{43}$/);
      readKey = r.body.key;
      const w = await make("deploy", "write");
      writeKey = w.body.key;
      writeKeyId = w.body.id;
      const list = await api.get("/api/keys").set(bearer(token.ana));
      expect(list.body.items).toHaveLength(2);
      expect(JSON.stringify(list.body)).not.toContain(readKey);
      expect(JSON.stringify(list.body)).not.toContain(writeKey);
    });

    it("lets a key act as its owner within its scope", async () => {
      expect((await api.get("/api/auth/me").set(bearer(readKey))).body.user.username).toBe("ana");
      expect((await api.post("/api/projects").set(bearer(readKey)).send({ title: "API draft" })).status).toBe(403);
      const made = await api.post("/api/projects").set(bearer(writeKey)).send({ title: "API draft" });
      expect(made.status).toBe(201);
      expect((await api.delete(`/api/projects/${made.body.id}`).set(bearer(writeKey))).status).toBe(200);
      expect((await api.get("/api/auth/me").set(bearer("idv_" + "A".repeat(43)))).status).toBe(401);
    });

    it("keeps keys away from account and admin actions", async () => {
      expect((await api.post("/api/keys").set(bearer(writeKey)).send({ name: "x", scope: "read" })).status).toBe(403);
      const pw = await api.post("/api/auth/change-password").set(bearer(writeKey)).send({ currentPassword: "password123", newPassword: "another-pass-1" });
      expect(pw.status).toBe(403);
      const adminKey = (await api.post("/api/keys").set(bearer(token.cy)).send({ name: "admin", scope: "write" })).body.key;
      expect((await api.get("/api/admin/reports").set(bearer(adminKey))).status).toBe(403);
    });

    it("stops a key the moment it is revoked, and caps active keys at 10", async () => {
      expect((await api.delete(`/api/keys/${writeKeyId}`).set(bearer(token.ana))).status).toBe(200);
      expect((await api.get("/api/auth/me").set(bearer(writeKey))).status).toBe(401);
      for (let i = 0; i < 9; i++) await api.post("/api/keys").set(bearer(token.ana)).send({ name: `k${i}`, scope: "read" });
      expect((await api.post("/api/keys").set(bearer(token.ana)).send({ name: "one-too-many", scope: "read" })).status).toBe(400);
    });

    it("only accepts public https addresses, and only from creators", async () => {
      const add = (url: string, events = ["project.published"]) => api.post("/api/webhooks").set(bearer(token.ana)).send({ url, events });
      const bad = ["http://hooks.example.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/x", "https://user:pw@hooks.example.com/x", "https://intranet/x", "not a url"];
      for (const url of bad) expect((await add(url)).status, url).toBe(400);
      expect((await add("https://hooks.example.com/x", [])).status).toBe(400);

      const fay = await signup("fay");
      expect((await api.post("/api/webhooks").set(bearer(fay.body.token)).send({ url: "https://hooks.example.com/x", events: ["project.published"] })).status).toBe(403);

      const ok = await add("https://hooks.example.com/idevrx", ["project.published", "comment.created"]);
      expect(ok.status).toBe(201);
      expect(ok.body.secret).toMatch(/^[a-f0-9]{48}$/);
      hookId = ok.body.id;
      hookSecret = ok.body.secret;
      const list = await api.get("/api/webhooks").set(bearer(token.ana));
      expect(list.body.items[0]).toMatchObject({ url: "https://hooks.example.com/idevrx", active: true });
      expect(JSON.stringify(list.body)).not.toContain(hookSecret);
    });

    it("signs each delivery so the receiver can check it", async () => {
      const t = await api.post(`/api/webhooks/${hookId}/test`).set(bearer(token.ana));
      expect(t.body).toEqual({ ok: true, status: 200 });
      const call = hookCalls.at(-1)!;
      expect(call.url).toBe("https://hooks.example.com/idevrx");
      expect(call.headers["X-Idevrx-Event"]).toBe("ping");
      expect(JSON.parse(call.body).id).toBe(call.headers["X-Idevrx-Delivery"]);
      const expected = "sha256=" + createHmac("sha256", hookSecret).update(`${call.headers["X-Idevrx-Timestamp"]}.${call.body}`).digest("hex");
      expect(call.headers["X-Idevrx-Signature"]).toBe(expected);
    });

    it("sends subscribed events only, and nothing while paused", async () => {
      const before = hookCalls.length;
      await api.post("/api/projects/001/comments").set(bearer(token.bob)).send({ body: "Nice build" });
      await vi.waitFor(() => expect(hookCalls.length).toBe(before + 1));
      expect(JSON.parse(hookCalls.at(-1)!.body)).toMatchObject({ event: "comment.created", data: { project: "001", author: "bob", body: "Nice build" } });

      await api.post(`/api/projects/${projectId}/publish`).set(bearer(token.ana)).send({});
      await vi.waitFor(() => expect(hookCalls.length).toBe(before + 2));
      expect(JSON.parse(hookCalls.at(-1)!.body)).toMatchObject({ event: "project.published", data: { number: "001" } });

      await api.put("/api/users/ana/follow").set(bearer(token.cy)); // user.followed: not subscribed
      await wait(200);
      expect(hookCalls.length).toBe(before + 2);

      expect((await api.patch(`/api/webhooks/${hookId}`).set(bearer(token.ana)).send({ active: false })).status).toBe(200);
      await api.post("/api/projects/001/comments").set(bearer(token.bob)).send({ body: "Another" });
      await wait(200);
      expect(hookCalls.length).toBe(before + 2);

      expect((await api.delete(`/api/webhooks/${hookId}`).set(bearer(token.ana))).status).toBe(200);
      expect((await api.get("/api/webhooks").set(bearer(token.ana))).body.items).toHaveLength(0);
    });
  });

  describe("learning", () => {
    it("lists paths, lessons and progress, and links projects", async () => {
      const path = await LearningPath.create({ slug: "robotics-fundamentals", title: "Robotics Fundamentals", level: "Beginner", summary: "Sensors, motors and control.", order: 1, projectNumbers: ["001"] });
      await Lesson.create([
        { path: path._id, slug: "sensors", title: "Sensors", order: 1, minutes: 6, body: "A.\n\nB." },
        { path: path._id, slug: "motors", title: "Motors", order: 2, minutes: 7, body: "C." },
      ]);
      await mongoose.syncIndexes();

      const list = await api.get("/api/learning");
      expect(list.body.items[0]).toMatchObject({ slug: "robotics-fundamentals", lessons: 2, projects: 1 });

      const lesson = await api.get("/api/learning/robotics-fundamentals/lessons/sensors");
      expect(lesson.body).toMatchObject({ index: 1, total: 2, prev: null, next: { slug: "motors" } });

      expect((await api.get("/api/projects/001")).body.paths[0].slug).toBe("robotics-fundamentals");
      expect((await api.get("/api/search?q=robotics")).body.learning.length).toBeGreaterThan(0);
    });

    it("tracks lesson and project progress idempotently", async () => {
      const detail = await api.get("/api/learning/robotics-fundamentals").set(bearer(token.bob));
      const lessonId = detail.body.lessons[0].id;
      const done = () => api.put(`/api/learning/lessons/${lessonId}/complete`).set(bearer(token.bob));
      await done();
      await done();
      expect((await api.put("/api/learning/robotics-fundamentals/projects/001/complete").set(bearer(token.bob))).body.done).toBe(true);
      expect((await api.put("/api/learning/robotics-fundamentals/projects/002/complete").set(bearer(token.bob))).status).toBe(404);

      const after = await api.get("/api/learning/robotics-fundamentals").set(bearer(token.bob));
      expect(after.body.progress).toEqual({ lessonsDone: 1, lessonsTotal: 2, projectsDone: 1, projectsTotal: 1 });
      await api.delete(`/api/learning/lessons/${lessonId}/complete`).set(bearer(token.bob));
      const undone = await api.get("/api/learning/robotics-fundamentals").set(bearer(token.bob));
      expect(undone.body.progress.lessonsDone).toBe(0);
    });

    it("lets only admins manage learning content", async () => {
      expect((await api.post("/api/learning").set(bearer(token.bob)).send({ title: "Nope" })).status).toBe(403);
      await User.updateOne({ username: "cy" }, { role: "admin" });
      const created = await api.post("/api/learning").set(bearer(token.cy)).send({ title: "Arduino Fundamentals", level: "Beginner" });
      expect(created.status).toBe(201);
      expect(created.body.slug).toBe("arduino-fundamentals");
      const lesson = await api.post("/api/learning/arduino-fundamentals/lessons").set(bearer(token.cy)).send({ title: "Blink an LED", body: "First.\n\nSecond." });
      expect(lesson.status).toBe(201);
      expect(lesson.body.slug).toBe("blink-an-led");
    });
  });
});
