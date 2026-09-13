import { Request, Response, NextFunction } from "express";

const PROJECT_WRITE_ROLES = new Set(["creator", "moderator", "admin", "ceo"]);

/**
 * Blocks any authenticated user without a project-write role.
 * Per Roles & Permissions §13 — Registered Users receive authorization
 * errors from all project-creation and project-management APIs.
 */
export function requireCreator(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required." },
    });
  }
  if (!PROJECT_WRITE_ROLES.has(user.role)) {
    return res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Creator access required." },
    });
  }
  next();
}

/**
 * Ownership check — creators may only modify their own projects.
 * Roles & Permissions §13.
 */
export function requireProjectOwner(project: { authorId: any }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ success: false, error: { code: "AUTH_REQUIRED" } });
    const isOwner = String(project.authorId) === String(user._id);
    const isStaff = ["moderator", "admin", "ceo"].includes(user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You do not own this project." },
      });
    }
    next();
  };
}
