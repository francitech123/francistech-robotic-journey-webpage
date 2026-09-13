import { Schema, model, Document, Types } from "mongoose";

export interface IComponent extends Document {
  projectId: Types.ObjectId;
  name: string;
  description?: string;
  quantity: number;
  unit?: string;
  category?: string;
  partNumber?: string;
  manufacturer?: string;
  estimatedUnitCost?: number;
  currency?: string;
  supplierName?: string;
  supplierUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const componentSchema = new Schema<IComponent>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    quantity: { type: Number, required: true, default: 1 },
    unit: { type: String, default: "pcs" },
    category: { type: String },
    partNumber: { type: String },
    manufacturer: { type: String },
    estimatedUnitCost: { type: Number },
    currency: { type: String, default: "USD" },
    supplierName: { type: String },
    supplierUrl: { type: String },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Component = model<IComponent>("Component", componentSchema);
