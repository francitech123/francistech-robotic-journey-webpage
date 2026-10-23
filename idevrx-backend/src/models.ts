import { Schema, model } from "mongoose";

export const ROLES = ["user", "creator", "admin"] as const;
export const STATUSES = ["DRAFT", "READY_FOR_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"] as const;
export const CATEGORIES = ["Robotics", "Electronics", "AI & Computer Vision", "Mechanical", "Automation"] as const;
export const FILE_KINDS = ["cover", "source", "cad", "image", "document", "archive", "video"] as const;

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    bio: { type: String, default: "" },
    followers: { type: Number, default: 0 },
    role: { type: String, enum: ROLES, default: "user" },
    creatorRequested: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    passwordChangedAt: Date,
  },
  { timestamps: true }
);
export const User = model("User", userSchema);

const component = new Schema(
  { name: String, qty: { type: Number, default: 1 }, spec: { type: String, default: "" } },
  { _id: false }
);

const projectSchema = new Schema(
  {
    number: String, // "001", assigned on first publish
    slug: String,
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    creatorUsername: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, default: CATEGORIES[0] },
    difficulty: { type: Number, min: 1, max: 4, default: 1 },
    buildTime: { type: String, default: "" },
    cost: { type: String, default: "" },
    buildStatus: { type: String, enum: ["Completed", "In progress"], default: "Completed" },
    tags: { type: [String], default: [] },
    controller: { type: String, default: "" },
    language: { type: String, default: "" },
    sensors: { type: String, default: "" },
    actuators: { type: String, default: "" },
    power: { type: String, default: "" },
    communication: { type: String, default: "" },
    coverImageKey: String,
    components: { type: [component], default: [] },
    why: { type: String, default: "" },
    steps: { type: [String], default: [] },
    problems: { type: String, default: "" },
    nextVersion: { type: String, default: "" },
    youtubeUrl: { type: String, default: "" },
    youtubeId: { type: String, default: "" },
    version: { type: String, default: "1.0" },
    history: { type: [{ version: String, note: String, date: Date, _id: false }], default: [] },
    status: { type: String, enum: STATUSES, default: "DRAFT", index: true },
    pending: Schema.Types.Mixed, // edits to a published project, applied on next publish
    publishedAt: Date,
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    forkOf: { type: Schema.Types.ObjectId, ref: "Project" },
    forkOfNumber: String,
    forkOfCreator: String,
    forkCount: { type: Number, default: 0 }, // published forks, also used to number them (001-F1, 001-F2)
    allowForks: { type: Boolean, default: true },
    featured: { type: Boolean, default: false, index: true },
    featuredAt: Date,
    moderationNote: String,
  },
  { timestamps: true }
);
projectSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { number: { $type: "string" } } });
projectSchema.index({ status: 1, publishedAt: -1 });
projectSchema.index(
  { title: "text", description: "text", tags: "text", controller: "text", language: "text", sensors: "text", actuators: "text", creatorUsername: "text" },
  { weights: { title: 10, tags: 6, controller: 4, description: 2 } }
);
export const Project = model("Project", projectSchema);

export const ProjectVersion = model(
  "ProjectVersion",
  new Schema(
    {
      project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
      version: String,
      note: String,
      snapshot: Schema.Types.Mixed,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

export const ProjectFile = model(
  "ProjectFile",
  new Schema(
    {
      project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
      uploader: { type: Schema.Types.ObjectId, ref: "User", required: true },
      filename: { type: String, required: true },
      size: { type: Number, required: true },
      contentType: { type: String, required: true },
      kind: { type: String, enum: FILE_KINDS, required: true },
      storageKey: { type: String, required: true },
      status: { type: String, enum: ["PENDING", "READY"], default: "PENDING" },
    },
    { timestamps: true }
  )
);

export const Counter = model("Counter", new Schema({ _id: String, seq: { type: Number, default: 0 } }));
export const nextNumber = async () => {
  const c = await Counter.findOneAndUpdate({ _id: "project" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return String(c.seq).padStart(3, "0");
};

// ---- Community (Phase 3)
const pair = (a: string, b: string, refB: string) => {
  const s = new Schema(
    {
      [a]: { type: Schema.Types.ObjectId, ref: "User", required: true },
      [b]: { type: Schema.Types.ObjectId, ref: refB, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  );
  s.index({ [a]: 1, [b]: 1 }, { unique: true });
  s.index({ [b]: 1 });
  return s;
};
export const Like = model("Like", pair("user", "project", "Project"));
export const Save = model("Save", pair("user", "project", "Project"));
export const Follow = model("Follow", pair("follower", "following", "User"));

export const Comment = model(
  "Comment",
  new Schema(
    {
      project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
      author: { type: Schema.Types.ObjectId, ref: "User", required: true },
      authorUsername: { type: String, required: true },
      body: { type: String, required: true },
      parent: { type: Schema.Types.ObjectId, ref: "Comment", index: true }, // replies are one level deep
    },
    { timestamps: true }
  )
);

// Only meaningful events: a comment on your project, a reply to your comment, a new follower.
export const Notification = model(
  "Notification",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      type: { type: String, enum: ["comment", "reply", "follow", "featured", "moderation"], required: true },
      actorUsername: { type: String, required: true },
      projectNumber: String,
      projectTitle: String,
      message: String,
      read: { type: Boolean, default: false },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

// ---- Learning (Phase 4)
const pathSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    level: { type: String, enum: ["Beginner", "Intermediate", "Advanced", "Expert"], default: "Beginner" },
    summary: { type: String, default: "" },
    order: { type: Number, default: 0 },
    projectNumbers: { type: [String], default: [] }, // published projects linked to this path, e.g. ["001", "004"]
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);
pathSchema.index({ title: "text", summary: "text" });
export const LearningPath = model("LearningPath", pathSchema);

const lessonSchema = new Schema(
  {
    path: { type: Schema.Types.ObjectId, ref: "LearningPath", required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    order: { type: Number, default: 0 },
    minutes: { type: Number, default: 5 },
    body: { type: String, default: "" },
  },
  { timestamps: true }
);
lessonSchema.index({ path: 1, slug: 1 }, { unique: true });
export const Lesson = model("Lesson", lessonSchema);

const progressSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    path: { type: Schema.Types.ObjectId, ref: "LearningPath", required: true },
    kind: { type: String, enum: ["lesson", "project"], required: true },
    ref: { type: String, required: true }, // lesson id, or project number
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
progressSchema.index({ user: 1, kind: 1, ref: 1 }, { unique: true });
progressSchema.index({ user: 1, path: 1 });
export const Progress = model("Progress", progressSchema);

// ---- Moderation (Phase 6 prep)
export const REPORT_REASONS = ["spam", "unsafe", "copyright", "harassment", "other"] as const;
const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reporterUsername: { type: String, required: true },
    targetType: { type: String, enum: ["project", "comment"], required: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    projectNumber: String,
    projectTitle: String,
    comment: { type: Schema.Types.ObjectId, ref: "Comment" },
    snapshot: { type: String, default: "" }, // the project title or comment text at report time
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: "" },
    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open", index: true },
    handledBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
reportSchema.index({ reporter: 1, targetType: 1, project: 1, comment: 1 }, { unique: true }); // one report per person per target
export const Report = model("Report", reportSchema);

// ---- Email verification and password reset tokens (only a hash is stored)
const tokenSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["verify", "reset", "email"], required: true },
  email: String, // the new address, for "email" tokens
  hash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
});
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // expired tokens delete themselves
export const Token = model("Token", tokenSchema);

// ---- Developer tools (Phase 6)
export const WEBHOOK_EVENTS = ["project.published", "comment.created", "user.followed"] as const;

export const ApiKey = model(
  "ApiKey",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      name: { type: String, required: true },
      scope: { type: String, enum: ["read", "write"], required: true },
      prefix: { type: String, required: true }, // the first characters, so a key can be recognised in a list
      hash: { type: String, required: true, unique: true }, // sha256 of the key; the key itself is never stored
      lastUsedAt: Date,
      revokedAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
  )
);

export const Webhook = model(
  "Webhook",
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      url: { type: String, required: true },
      secret: { type: String, required: true }, // signs deliveries; shown to the owner once
      events: { type: [String], enum: WEBHOOK_EVENTS, default: [] },
      active: { type: Boolean, default: true },
      failures: { type: Number, default: 0 }, // consecutive; the webhook pauses at 10
      lastStatus: String,
      lastDeliveryAt: Date,
    },
    { timestamps: true }
  )
);
