import { useState } from "react";

export default function FileUploadField({
  projectId,
  category,
}: {
  projectId: string;
  category: "cover" | "gallery" | "videos" | "code" | "cad" | "schematics" | "documents" | "other";
}) {
  const [progress, setProgress] = useState(0);

  async function handleFile(file: File) {
    // 1. Ask backend for presigned PUT.
    const signRes = await fetch(`/api/projects/${projectId}/files/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        category,
        originalFilename: file.name,
        mimeType: file.type,
        size: file.size,
      }),
    });
    if (!signRes.ok) throw new Error("SIGN_FAILED");
    const { data } = await signRes.json();
    const { uploadUrl, fileId } = data;

    // 2. Upload directly to object storage.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("UPLOAD_FAILED")));
      xhr.onerror = () => reject(new Error("UPLOAD_FAILED"));
      xhr.send(file);
    });

    // 3. Tell backend to persist metadata.
    await fetch(`/api/projects/${projectId}/files/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fileId }),
    });
  }

  return (
    <label className="file-upload">
      <input
        type="file"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {progress > 0 && <progress value={progress} max={100} />}
    </label>
  );
}
