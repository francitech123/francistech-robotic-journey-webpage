import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type FileRec = {
  _id: string;
  filename: string;
  category: string;
  originalFilename: string;
};

type Project = {
  youtubeVideoId?: string;
  title: string;
};

export default function GalleryTab() {
  const { projectNumber, slug } = useParams();
  const [images, setImages] = useState<{ id: string; url: string; caption: string }[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/projects/${projectNumber}/${slug}/files`).then((r) => r.json()),
      fetch(`/api/projects/${projectNumber}/${slug}`).then((r) => r.json()),
    ]).then(async ([f, p]) => {
      const gallery = (f?.data?.files ?? []).filter((x: FileRec) => x.category === "gallery" || x.category === "cover");
      const withUrls = await Promise.all(
        gallery.map(async (g: FileRec) => {
          const r = await fetch(`/api/files/${g._id}/download`, { credentials: "include" });
          const j = await r.json();
          return { id: g._id, url: j?.data?.url ?? "", caption: g.originalFilename };
        })
      );
      setImages(withUrls.filter((x) => x.url));
      setProject(p?.data?.project ?? null);
    }).finally(() => setLoading(false));
  }, [projectNumber, slug]);

  if (loading) return <div className="skeleton skeleton--grid" />;

  return (
    <section className="tab-gallery">
      <h2>
