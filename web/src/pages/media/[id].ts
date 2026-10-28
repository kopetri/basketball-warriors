// Public media proxy. Directus stays behind Cloudflare Access; this serves only files that published content
// references. Images: always resized to a few fixed widths (?w=), so nobody can make Directus render arbitrary
// transforms and image originals (which may carry camera metadata) never leave. Videos: the original file (no ?w=),
// with Range support, because Safari plays video only through 206 partial responses.
import type { APIRoute } from 'astro';
import { isPublicFile } from '../../lib/data';

const WIDTHS = new Set([320, 640, 960, 1600]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new Response(null, { status: 404 });

export const GET: APIRoute = async ({ params, url, request }) => {
  const id = params.id ?? '';
  const w = url.searchParams.get('w');
  if (!UUID.test(id) || (w !== null && !WIDTHS.has(Number(w))) || !(await isPublicFile(id))) return notFound();

  if (w === null) {
    const range = request.headers.get('range');
    const res = await fetch(`${process.env.DIRECTUS_URL}/assets/${id}`, { headers: range ? { Range: range } : {} });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('video/')) return notFound();
    const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
    for (const h of ['content-length', 'content-range']) if (res.headers.has(h)) headers.set(h, res.headers.get(h)!);
    return new Response(res.body, { status: res.status, headers });
  }

  const res = await fetch(
    `${process.env.DIRECTUS_URL}/assets/${id}?width=${w}&fit=inside&withoutEnlargement=true&format=webp&quality=80`,
  );
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return notFound();
  return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
};
