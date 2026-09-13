import { Schema, model, Document, Types } from "mongoose";

export interface IProjectStep extends Document {
  projectId: Types.ObjectId;
  stepNumber: number;
  title: string;
  description?: string;
  images: string[];
  videos: string[];
  files: string[];
  notes?: string;
  warnings?: string;
  createdAt: Date;
  updatedAt: Date;
}

const stepSchema = new Schema<IProjectStep>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    stepNumber: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    images: { type: [String], default: [] },
    videos: { type: [String], default: [] },
    files: { type: [String], default: [] },
    notes: { type: String, default: "" },
    warnings: { type: String, default: "" },
  },
  { timestamps: true }
);

stepSchema.index({ projectId: 1, stepNumber: 1 }, { unique: true });

export const ProjectStep = model<IProjectStep>("ProjectStep", stepSchema);
