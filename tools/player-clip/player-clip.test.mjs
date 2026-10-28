// Run: npm test   (no Replicate token needed: checks the local backdrop step only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { FRAME, onBackdrop } from './player-clip.mjs';

test('cut-out player lands centred on the dark backdrop at frame size', async () => {
  // 600x800 transparent canvas with an opaque red "player" in the middle
  const player = await sharp({ create: { width: 200, height: 400, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const cutout = await sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: player }])
    .png()
    .toBuffer();

  const { data, info } = await sharp(await onBackdrop(cutout)).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, FRAME.width);
  assert.equal(info.height, FRAME.height);
  assert.equal(info.channels, 3); // opaque video frame, no alpha
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.deepEqual(px(FRAME.width / 2, FRAME.height / 2), [255, 0, 0]);
  // corners are (almost) the website background #0b0707, so the clip blends into the page
  for (const [x, y] of [[0, 0], [FRAME.width - 1, FRAME.height - 1]]) {
    px(x, y).forEach((c, i) => assert.ok(Math.abs(c - [11, 7, 7][i]) <= 3, `corner ${x},${y}: ${px(x, y)}`));
  }
});
