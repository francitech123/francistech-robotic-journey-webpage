import { Schema, model, Document, Types } from "mongoose";

export const FILE_CATEGORIES = [
  "cover",
  "gallery",
  "video",
  "code",
  "cad",
  "schematic",
  "document",
  "other",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_ACCESS_POLICIES = [
  "public",
  "authenticated",
  "creator-only",
  "private",
] as const;
export type FileAccessPolicy = (typeof FILE_ACCESS_POLICIES)[number];

export interface IProjectFile extends Document {
  projectId: Types.ObjectId;
  stepId?: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  filename: string;               // safe filename
  originalFilename: string;
  storageProvider: string;        // "s3" | "cloudinary" | etc.
  bucket: string;                 // "idevrx-development" | "idevrx-production"
  storageKey: string;             // projects/{number}/{category}/{fileId}-{safeFilename}
  mimeType: string;
  size: number;
  category: FileCategory;
  width?: number;
  height?: number;
  status: "pending" | "ready" | "failed" | "orphaned";
  downloadable: boolean;
  accessPolicy: FileAccessPolicy;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IProjectFile>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    stepId: { type: Schema.Types.ObjectId, ref: "ProjectStep" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    filename: { type: String, required: true },
    originalFilename: { type: String, required: true },
    storageProvider: { type: String, required: true },
    bucket: { type: String, required: true },
    storageKey: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    category: { type: String, enum: FILE_CATEGORIES, required: true },
    width: { type: Number },
    height: { type: Number },
    status: { type: String, enum: ["pending", "ready", "failed", "orphaned"], default: "pending" },
    downloadable: { type: Boolean, default: false },
    accessPolicy: { type: String, enum: FILE_ACCESS_POLICIES, default: "creator-only" },
  },
  { timestamps: true }
);

fileSchema.index({ projectId: 1, category: 1 });

export const ProjectFile = model<IProjectFile>("ProjectFile", fileSchema);
