import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type FileRec = {
  _id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  category: string;
  downloadable: boolean;
  createdAt: string;
};

const ICONS: Record<string, string> = {
  code: "💻", cad: "⚙️", schematic: "📐", document: "📄",
  gallery: "🖼️", video: "🎥", cover: "🖼️", other: "📦",
};

export default function FilesTab() {
  const { projectNumber, slug } = useParams();
  const [files, setFiles] = useState<FileRec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectNumber}/${slug}/files`)
      .then((r) => r.json())
      .then((r) => setFiles(r?.data?.files ?? []))
      .finally(() => setLoading(false));
  }, [projectNumber, slug]);

  if (loading) return <div className="skeleton skeleton--list" />;
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No files uploaded yet.</p>
      </div>
    );
  }

  async function download(file: FileRec) {
    const r = await fetch(`/api/files/${file._id}/download`, { credentials: "include" });
    const j = await r.json();
    if (j?.data?.url) window.location.href = j.data.url;
  }

  return (
    <section className="tab-files">
      <h2>Project files</h2>
      <ul className="file-list">
        {files.map((f) => (
          <li key={f._id} className="file-row">
            <span className="file-row__icon" aria-hidden="true">{ICONS[f.category] ?? "📦"}</span>
            <span className="file-row__name">{f.originalFilename}</span>
            <span className="file-row__meta">{humanSize(f.size)} · {new Date(f.createdAt).toLocaleDateString()}</span>
            {f.downloadable ? (
              <button className="btn btn-secondary btn--sm" onClick={() => download(f)}>Download</button>
            ) : (
              <span className="file-row__locked">Not downloadable</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
