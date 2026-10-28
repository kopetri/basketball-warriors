#!/usr/bin/env node
// Player intro clip from one photo, using the Replicate API:
//
//   photo ─► input.png (upright, metadata such as GPS removed)
//         ├► EDIT_MODEL: start frame (side profile, arms hanging) ─► CUTOUT_MODEL ─► dark backdrop ─► start.png ─┐
//         └► EDIT_MODEL: end frame (facing camera, arms crossed)  ─► CUTOUT_MODEL ─► dark backdrop ─► end.png ───┤
//                                                                           VIDEO_MODEL (first + last frame) ◄──┘─► clip.mp4
//
// Usage:  node player-clip.mjs <photo.jpg|png|heic> [--out <dir>] [--draft] [--seed <n>] [--duration <s>]
// Token:  REPLICATE_API_TOKEN, or the file ~/.config/replicate-token
// Every step writes its result into the out dir (default: out/<photo name>/) and is skipped when that file exists,
// so a new video only costs the video step. Delete a file to redo its step (e.g. start-raw.png for a new start pose).
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const EDIT_MODEL = 'google/nano-banana-pro';
const CUTOUT_MODEL = 'bria/remove-background';
const VIDEO_MODEL = 'prunaai/p-video-2';
export const FRAME = { width: 1080, height: 1440 }; // 3:4 portrait = 1080p video, fits the site's player cards
const BACKDROP = { centre: '#221c18', edge: '#0b0707' }; // edge = website background, so the clip blends into the page

const SAME_PERSON =
  'Keep the exact same person from the reference photo: identical face, hairstyle, facial hair, skin tone, body build ' +
  'and tattoos, and the identical jersey with the same number, logo and sponsor print. Same framing, camera height and ' +
  'distance as the reference.';
const STUDIO_LOOK =
  'Background: plain, seamless, dark charcoal studio backdrop with nothing else in the scene. Lighting: professional ' +
  'sports media-day portrait lighting, soft key light from the front, subtle rim light separating the player from the ' +
  'dark background. Photorealistic, sharp focus, clean image without added graphics or text.';
export const PROMPTS = {
  start:
    `${SAME_PERSON} Pose: standing upright in strict side profile, body turned 90 degrees so the player faces the left ` +
    `edge of the frame, arms hanging relaxed at the sides, calm neutral expression, gaze straight ahead. ${STUDIO_LOOK}`,
  end:
    `${SAME_PERSON} Pose: standing square to the camera with the arms crossed over the chest, looking straight into ` +
    `the lens with a calm, confident, slight smile. ${STUDIO_LOOK}`,
  video:
    'Professional basketball player introduction clip on a dark studio background. The video opens with the player ' +
    'standing in side profile, arms hanging relaxed, gaze straight ahead. After a brief moment the player turns ' +
    'smoothly and confidently toward the camera, head leading the turn, and looks right into the lens, crossing the ' +
    'arms over the chest while completing the turn, ending square to the camera with arms crossed and a calm, ' +
    'self-assured expression, holding the pose. One continuous, natural, realistic motion; hands stay anatomically ' +
    'correct with five fingers. Locked-off camera at chest height. Soft frontal key light with a subtle rim light; the ' +
    'background stays plain and dark throughout. Face, hair, jersey number, team logo and sponsor print stay ' +
    'consistent and sharp. Photorealistic.',
};

// Cut-out player (transparent PNG) centred on the dark studio gradient, at FRAME size.
export async function onBackdrop(cutout) {
  const { width, height } = FRAME;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<radialGradient id="g" cx="50%" cy="42%" r="58%"><stop offset="0" stop-color="${BACKDROP.centre}"/>` +
    `<stop offset="1" stop-color="${BACKDROP.edge}"/></radialGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  const player = await sharp(cutout)
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: player }]).removeAlpha().png().toBuffer();
}

const API = 'https://api.replicate.com/v1';
let token;

async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    const body = await res.json().catch(() => ({}));
    // accounts with little credit are throttled to a few requests per minute: wait and retry
    if (res.status === 429 && attempt <= 10) {
      const wait = Number(res.headers.get('retry-after')) || Number(/~(\d+)s/.exec(body.detail ?? '')?.[1]) || 10;
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${body.detail ?? JSON.stringify(body)}`);
    return body;
  }
}

async function upload(file) {
  const form = new FormData();
  form.append('content', new Blob([await readFile(file)], { type: 'image/png' }), basename(file));
  return (await api('/files', { method: 'POST', body: form })).urls.get;
}

async function create(model, input) {
  const post = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify(body),
  });
  try {
    return await api(`/models/${model}/predictions`, post({ input }));
  } catch (e) {
    if (!/HTTP 404/.test(e.message)) throw e;
    const { latest_version } = await api(`/models/${model}`); // community models need an explicit version
    return api('/predictions', post({ version: latest_version.id, input }));
  }
}

async function run(model, input, out) {
  let p = await create(model, input);
  const deadline = Date.now() + 20 * 60_000;
  while (!['succeeded', 'failed', 'canceled'].includes(p.status)) {
    if (Date.now() > deadline) throw new Error(`${model}: no result after 20 min (prediction ${p.id})`);
    await new Promise((r) => setTimeout(r, 3000));
    p = await api(p.urls.get);
  }
  await appendFile(
    join(out, 'predictions.log'),
    `${new Date().toISOString()} ${model} ${p.id} ${p.status} ${p.metrics?.predict_time ?? '?'}s\n`,
  );
  if (p.status !== 'succeeded') throw new Error(`${model}: ${p.status}: ${p.error ?? 'no error message'} (prediction ${p.id})`);
  const url = [p.output].flat()[0];
  if (typeof url !== 'string') throw new Error(`${model}: unexpected output ${JSON.stringify(p.output)}`);
  return url;
}

async function download(url, file) {
  const res = await fetch(url); // replicate.delivery links are public and expire after an hour
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      draft: { type: 'boolean', default: false },
      seed: { type: 'string' },
      duration: { type: 'string', default: '5' },
    },
  });
  const [photo] = positionals;
  if (!photo) throw new Error('usage: node player-clip.mjs <photo> [--out dir] [--draft] [--seed n] [--duration s]');
  token = (process.env.REPLICATE_API_TOKEN ?? (await readFile(join(homedir(), '.config/replicate-token'), 'utf8').catch(() => ''))).trim();
  if (!token) throw new Error('Replicate token missing: set REPLICATE_API_TOKEN or write it to ~/.config/replicate-token');

  const out = values.out ?? join(import.meta.dirname, 'out', basename(photo, extname(photo)));
  await mkdir(out, { recursive: true });
  const f = (name) => join(out, name);
  const step = async (name, make) => {
    if (await access(f(name)).then(() => true, () => false)) return console.log(`cached  ${name}`);
    console.log(`running ${name} ...`);
    await make(f(name));
    console.log(`done    ${name}`);
  };

  // rotate() applies the camera orientation; sharp drops all other metadata, including GPS
  await step('input.png', async (file) =>
    writeFile(file, await sharp(photo).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()),
  );
  let inputUrl;
  const frame = (pose) =>
    step(`${pose}-raw.png`, async (file) => {
      inputUrl ??= upload(f('input.png'));
      const input = { prompt: PROMPTS[pose], image_input: [await inputUrl], aspect_ratio: '3:4', resolution: '2K', output_format: 'png' };
      await download(await run(EDIT_MODEL, input, out), file);
    })
      .then(() => step(`${pose}-cutout.png`, async (file) => download(await run(CUTOUT_MODEL, { image: await upload(f(`${pose}-raw.png`)) }, out), file)))
      .then(() => step(`${pose}.png`, async (file) => writeFile(file, await onBackdrop(f(`${pose}-cutout.png`)))));
  await Promise.all([frame('start'), frame('end')]);

  const clip = values.draft ? 'clip-draft.mp4' : 'clip.mp4';
  await step(clip, async (file) => {
    const input = {
      prompt: PROMPTS.video,
      image: await upload(f('start.png')),
      last_frame_image: await upload(f('end.png')),
      duration: Number(values.duration),
      resolution: '1080p',
      fps: 24,
      prompt_upsampling: false, // keep our wording; upsampling may add other movements
      save_audio: false, // the site plays clips muted
      draft: values.draft,
      ...(values.seed && { seed: Number(values.seed) }),
    };
    await download(await run(VIDEO_MODEL, input, out), file);
  });
  console.log(`\nclip: ${f(clip)}\nframes: ${f('start.png')}, ${f('end.png')}`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
