import { useEffect, useState } from "react";
import { useParams, NavLink, Routes, Route, Navigate } from "react-router-dom";

type ProjectResponse = {
  project: any;
  steps: any[];
  components: any[];
  files: any[];
};

const TABS = [
  { path: "overview", label: "Overview" },
  { path: "build", label: "Build" },
  { path: "components", label: "Components" },
  { path: "code", label: "Code" },
  { path: "files", label: "Files" },
  { path: "schematics", label: "Schematics" },
  { path: "gallery", label: "Gallery" },
  { path: "discussion", label: "Discussion" },
  { path: "updates", label: "Updates" },
  { path: "versions", label: "Versions" },
  { path: "remixes", label: "Remixes" },
];

export default function ProjectPage() {
  const { projectNumber, slug } = useParams();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectNumber}/${slug}`)
      .then((r) => r.json())
      .then((r) => setData(r.data ?? null))
      .finally(() => setLoading(false));
  }, [projectNumber, slug]);

  if (loading) return <ProjectSkeleton />;
  if (!data) return <ProjectNotFound />;

  return (
    <div className="project-page">
      <ProjectHeader project={data.project} />
      <nav className="project-tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <NavLink
            key={t.path}
            to={`/ide/project-${projectNumber}/${slug}/${t.path}`}
            className={({ isActive }) => `project-tab ${isActive ? "project-tab--active" : ""}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="project-tab-body">
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewTab data={data} />} />
          <Route path="build" element={<BuildTab data={data} />} />
          {/* Phase 5 will register: components, code, files, schematics, gallery. */}
        </Routes>
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="project-skeleton" aria-busy="true">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--meta" />
      <div className="skeleton skeleton--cover" />
    </div>
  );
}

function ProjectNotFound() {
  return (
    <div className="empty-state">
      <p className="empty-state__title">Project not found.</p>
      <p className="empty-state__body">It may have been unpublished or removed.</p>
    </div>
  );
}

function ProjectHeader({ project }: { project: any }) {
  return (
    <header className="project-header">
      <div className="project-header__number">
        PROJECT {String(project.projectNumber).padStart(3, "0")}
      </div>
      <h1 className="project-header__title">{project.title}</h1>
      <p className="project-header__creator">By @{project.authorId?.username ?? "creator"}</p>
      <dl className="project-header__meta">
        {project.difficulty && (<><dt>Difficulty</dt><dd>{project.difficulty}</dd></>)}
        {project.buildTime && (<><dt>Build time</dt><dd>{project.buildTime}</dd></>)}
        {project.estimatedCost != null && (
          <><dt>Estimated cost</dt><dd>{project.currency} {project.estimatedCost}</dd></>
        )}
        <dt>Status</dt><dd>{project.status}</dd>
        <dt>Version</dt><dd>{project.version}</dd>
      </dl>
      {project.youtubeUrl && (
        <a
          className="btn btn-secondary"
          href={project.youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch on YouTube
        </a>
      )}
    </header>
  );
}

function OverviewTab({ data }: { data: ProjectResponse }) {
  const { project } = data;
  return (
    <section className="tab-overview">
      <h2>About this project</h2>
      <p>{project.description}</p>
      {project.youtubeVideoId && (
        <div className="project-embed">
          <iframe
            title="Project video"
            src={`https://www.youtube.com/embed/${project.youtubeVideoId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </section>
  );
}

export function BuildTab({ data }: { data: ProjectResponse }) {
  const { steps } = data;
  if (!steps.length) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No build steps yet.</p>
      </div>
    );
  }
  return (
    <ol className="build-steps">
      {steps.map((step) => (
        <li key={step._id} className="build-step" id={`step-${step.stepNumber}`}>
          <div className="build-step__num">
            STEP {String(step.stepNumber).padStart(2, "0")}
          </div>
          <h3 className="build-step__title">{step.title}</h3>
          {step.images?.length > 0 && (
            <div className="build-step__media">
              {step.images.map((src: string, i: number) => (
                <figure key={i}>
                  <img src={src} alt={`Step ${step.stepNumber} image ${i + 1}`} loading="lazy" />
                  <a className="btn btn-secondary btn--sm" href={src} download>Download image</a>
                </figure>
              ))}
            </div>
          )}
          {step.description && <div className="build-step__body">{step.description}</div>}
          {step.warnings && (
            <aside className="callout callout--warning">
              <strong>Warning:</strong> {step.warnings}
            </aside>
          )}
          {step.notes && (
            <aside className="callout callout--note">
              <strong>Note:</strong> {step.notes}
            </aside>
          )}
        </li>
      ))}
    </ol>
  );
}
