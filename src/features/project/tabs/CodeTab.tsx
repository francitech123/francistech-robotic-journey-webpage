import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

type FileRec = {
  _id: string;
  filename: string;
  mimeType: string;
  size: number;
  category: string;
  downloadable: boolean;
};

export default function CodeTab() {
  const { projectNumber, slug } = useParams();
  const [files, setFiles] = useState<FileRec[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectNumber}/${slug}/files`)
      .then((r) => r.json())
      .then((r) => {
        const code = (r?.data?.files ?? []).filter((f: FileRec) => f.category === "code");
        setFiles(code);
        setActiveId(code[0]?._id ?? null);
      })
      .finally(() => setLoading(false));
  }, [projectNumber, slug]);

  useEffect(() => {
    if (!activeId) { setContent(""); return; }
    // Fetch the short-lived signed URL, then fetch content text.
    fetch(`/api/files/${activeId}/download`, { credentials: "include" })
      .then((r) => r.json())
      .then(async (r) => {
        if (!r?.data?.url) return;
        const t = await fetch(r.data.url).then((x) => x.text());
        setContent(t);
      });
  }, [activeId]);

  const language = useMemo(() => guessLanguage(files.find((f) => f._id === activeId)?.filename ?? ""), [files, activeId]);

  if (loading) return <div className="skeleton skeleton--code" />;
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No code files attached yet.</p>
      </div>
    );
  }

  const active = files.find((f) => f._id === activeId);

  return (
    <section className="tab-code">
      <aside className="code-tree" aria-label="Files">
        {files.map((f) => (
          <button
            key={f._id}
            type="button"
            className={`code-tree__item ${f._id === activeId ? "code-tree__item--active" : ""}`}
            onClick={() => setActiveId(f._id)}
          >
            {f.filename}
          </button>
        ))}
      </aside>

      <div className="code-viewer">
        <header className="code-viewer__header">
          <span className="code-viewer__lang">{language}</span>
          <div className="code-viewer__actions">
            <button type="button" className="btn btn-secondary btn--sm" onClick={() => navigator.clipboard.writeText(content)}>Copy</button>
            {active && (
              <button
                type="button"
                className="btn btn-secondary btn--sm"
                onClick={async () => {
                  const r = await fetch(`/api/files/${active._id}/download`, { credentials: "include" });
                  const j = await r.json();
                  if (j?.data?.url) window.location.href = j.data.url;
                }}
              >Download</button>
            )}
          </div>
        </header>
        <pre className="code-viewer__pre"><code className="code-viewer__code">{withLineNumbers(content)}</code></pre>
      </div>
    </section>
  );
}

function withLineNumbers(src: string): string {
  return src.split("\n").map((line, i) => `${String(i + 1).padStart(2, "0")}  ${line}`).join("\n");
}

function guessLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    cpp: "Arduino / C++", c: "C", h: "C Header",
    py: "Python", js: "JavaScript", ts: "TypeScript",
    ino: "Arduino", md: "Markdown", json: "JSON",
  };
  return map[ext ?? ""] ?? "Plain Text";
}
