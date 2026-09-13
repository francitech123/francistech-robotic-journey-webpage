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
      <h2>Gallery</h2>

      {project?.youtubeVideoId && (
        <div className="gallery-embed">
          <iframe
            title="Project video"
            src={`https://www.youtube.com/embed/${project.youtubeVideoId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {images.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No gallery images yet.</p>
        </div>
      ) : (
        <ul className="gallery-grid">
          {images.map((img, i) => (
            <li key={img.id} className="gallery-item">
              <button type="button" onClick={() => setOpen(i)} aria-label={`Open image ${i + 1}`}>
                <img src={img.url} alt={img.caption} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && images[open] && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <button className="lightbox__close" onClick={() => setOpen(null)} aria-label="Close">×</button>
          <img src={images[open].url} alt={images[open].caption} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox__caption">{images[open].caption}</div>
          <a
            className="btn btn-secondary btn--sm lightbox__download"
            href={images[open].url}
            download
            onClick={(e) => e.stopPropagation()}
          >Download</a>
        </div>
      )}
    </section>
  );
}
