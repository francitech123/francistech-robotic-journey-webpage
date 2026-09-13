import { useState } from "react";

export default function YouTubeField({
  projectNumber,
  slug,
  initial,
}: {
  projectNumber: number;
  slug: string;
  initial?: string;
}) {
  const [url, setUrl] = useState(initial ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setStatus("saving");
    const r = await fetch(`/api/projects/${projectNumber}/${slug}/youtube`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ youtubeUrl: url || null }),
    });
    setStatus(r.ok ? "saved" : "error");
  }

  return (
    <div className="youtube-field">
      <label htmlFor="youtube-url">Project YouTube Video URL</label>
      <input
        id="youtube-url"
        className="input"
        type="url"
        placeholder="https://www.youtube.com/watch?v=..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={save}
      />
      {status === "saved" && <p className="hint">Saved.</p>}
      {status === "error" && <p className="hint hint--error">Invalid YouTube URL.</p>}
      <p className="hint">The video is embedded. It is not treated as a downloadable file.</p>
    </div>
  );
}
