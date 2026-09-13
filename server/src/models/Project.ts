import { Schema, model, Document, Types } from "mongoose";

export const PROJECT_STATUS = [
  "idea",
  "planning",
  "building",
  "testing",
  "completed",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

export const PROJECT_VISIBILITY = ["draft", "private", "unlisted", "public"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number];

export const DIFFICULTY = ["beginner", "intermediate", "advanced"] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

export interface IProject extends Document {
  projectNumber: number;           // 0 until published
  slug: string;                    // "" until published
  title: string;
  shortDescription?: string;
  description?: string;
  authorId: Types.ObjectId;
  categoryId?: Types.ObjectId;
  tags: string[];
  status: ProjectStatus;
  difficulty?: Difficulty;
  estimatedCost?: number;
  currency?: string;
  buildTime?: string;
  coverImage?: string;
  gallery: string[];
  youtubeUrl?: string;
  youtubeVideoId?: string;
  visibility: ProjectVisibility;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  viewCount: number;
  likeCount: number;
  bookmarkCount: number;
  commentCount: number;
  version: string;
  featured: boolean;
  searchText?: string;
}

const projectSchema = new Schema<IProject>(
  {
    projectNumber: { type: Number, default: 0 },   // 0 = not yet assigned
    slug: { type: String, default: "" },
    title: { type: String, required: true, trim: true },
    shortDescription: { type: String, default: "" },
    description: { type: String, default: "" },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", index: true },
    tags: { type: [String], default: [], index: true },
    status: { type: String, enum: PROJECT_STATUS, default: "idea", index: true },
    difficulty: { type: String, enum: DIFFICULTY },
    estimatedCost: { type: Number },
    currency: { type: String, default: "USD" },
    buildTime: { type: String },
    coverImage: { type: String },
    gallery: { type: [String], default: [] },
    youtubeUrl: { type: String },
    youtubeVideoId: { type: String },
    visibility: { type: String, enum: PROJECT_VISIBILITY, default: "draft", index: true },
    publishedAt: { type: Date, index: true },
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
    bookmarkCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    version: { type: String, default: "v1.0" },
    featured: { type: Boolean, default: false, index: true },
    searchText: { type: String },
  },
  { timestamps: true }
);

// Unique on projectNumber once assigned.
// Sparse index avoids clashing on the default 0 before publish.
projectSchema.index(
  { projectNumber: 1 },
  { unique: true, partialFilterExpression: { projectNumber: { $gt: 0 } } }
);

// Unique on slug once assigned.
projectSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $ne: "" } } }
);

projectSchema.index({ createdAt: -1 });
projectSchema.index({ publishedAt: -1 });
projectSchema.index({ title: "text", description: "text", shortDescription: "text", searchText: "text" });

export const Project = model<IProject>("Project", projectSchema);
