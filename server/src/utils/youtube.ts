/**
 * Accepts:
 *   https://www.youtube.com/watch?v=VIDEOID
 *   https://youtu.be/VIDEOID
 *   https://www.youtube.com/embed/VIDEOID
 * Returns the videoId or null.
 */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v") ?? "";
        return /^[\w-]{6,}$/.test(id) ? id : null;
      }
      const m = u.pathname.match(/^\/embed\/([\w-]{6,})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}
