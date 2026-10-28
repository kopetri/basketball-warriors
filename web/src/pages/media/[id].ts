// Public image proxy. Directus stays behind Cloudflare Access; this serves only images that published
// content references, in a few fixed sizes (so nobody can make Directus render arbitrary transforms).
import type { APIRoute } from 'astro';
import { isPublicFile } from '../../lib/data';

const WIDTHS = new Set([320, 640, 960, 1600]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id ?? '';
  const w = Number(url.searchParams.get('w') ?? 960);
  if (!UUID.test(id) || !WIDTHS.has(w) || !(await isPublicFile(id))) return new Response(null, { status: 404 });
  const res = await fetch(
    `${process.env.DIRECTUS_URL}/assets/${id}?width=${w}&fit=inside&withoutEnlargement=true&format=webp&quality=80`,
  );
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return new Response(null, { status: 404 });
  return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
};
