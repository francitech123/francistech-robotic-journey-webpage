import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Draft = {
  _id: string;
  title: string;
  coverImage?: string;
  status: "idea" | "planning" | "building" | "testing" | "completed" | "archived";
  updatedAt: string;
  // completion is derived client-side from filled fields; backend may also compute it.
  completion?: number;
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/drafts", { credentials: "include" })
      .then((r) => r.json())
      .then((r) => setDrafts(r?.data?.drafts ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="drafts-page">
        <div className="drafts-page__skeleton" />
      </div>
    );
  }

  return (
    <div className="drafts-page">
      <header className="drafts-page__header">
        <h1>My Drafts</h1>
      </header>

      {drafts.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No drafts yet.</p>
          <p className="empty-state__body">
            Start documenting your first build and share the process with the IDEVRX community.
          </p>
          <Link className="btn btn-primary" to="/create/project">Create Project</Link>
        </div>
      ) : (
        <ul className="draft-list">
          {drafts.map((d) => (
            <li key={d._id} className="draft-card">
              <img className="draft-card__cover" src={d.coverImage || "/placeholder-cover.png"} alt="" />
              <div className="draft-card__body">
                <h3 className="draft-card__title">{d.title}</h3>
                <p className="draft-card__meta">
                  Last edited {new Date(d.updatedAt).toLocaleString()}
                </p>
                <span className={`badge badge--stage badge--${d.status}`}>
                  {d.status}
                </span>
                {typeof d.completion === "number" && (
                  <span className="draft-card__completion">{d.completion}% complete</span>
                )}
              </div>
              <div className="draft-card__actions">
                <Link className="btn btn-secondary" to={`/create/project/${d._id}/edit`}>
                  Continue editing
                </Link>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await fetch(`/api/projects/${d._id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    setDrafts((prev) => prev.filter((x) => x._id !== d._id));
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
