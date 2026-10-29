import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convert } from './reference.mjs';
import { verify } from './verify.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-bench-'));
  try {
    const input = path.join(root, 'input.png');
    await sharp({ create: { width: 121, height: 79, channels: 4, background: '#76aa9980' } }).png().toFile(input);
    const job = { input, output: path.join(root, 'output'), widths: [60, 90], format: 'webp', quality: 80, effort: 6, cpu: 1, recursive: false };
    await mkdir(job.output);
    await run(job, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('srcset fully decodes, preserves aspect ratio, and has every width', () => fixture(async job => {
  await convert(job);
  const checked = await verify(job);
  assert.deepEqual(checked.images.map(i => [i.width, i.height]), [[60, 39], [90, 59]]);
}));
test('missing output fails', () => fixture(async job => {
  await convert(job);
  await rm(path.join(job.output, 'input-60w.webp'));
  await assert.rejects(verify(job), /Expected 2 images, found 1/);
}));
test('wrong format fails even when geometry matches', () => fixture(async job => {
  await convert(job);
  const file = path.join(job.output, 'input-60w.webp');
  const png = await sharp(file).png().toBuffer();
  await writeFile(file, png);
  await assert.rejects(verify(job), /Unexpected format or geometry/);
}));
test('truncated file fails full decode', () => fixture(async job => {
  await convert(job);
  const file = path.join(job.output, 'input-60w.webp');
  const bytes = await readFile(file);
  await writeFile(file, bytes.subarray(0, bytes.length - 12));
  await assert.rejects(verify(job));
}));
test('recursive files and preserve format are checked', () => fixture(async (job, root) => {
  const nested = path.join(root, 'tree/nested');
  await mkdir(nested, { recursive: true });
  await sharp(job.input).jpeg().toFile(path.join(nested, 'photo.jpg'));
  job.input = path.join(root, 'tree');
  job.recursive = true;
  job.format = 'preserve';
  await convert(job);
  const checked = await verify(job);
  assert.equal(checked.count, 2);
  assert(checked.images.every(i => i.format === 'jpeg'));
}));
test('blank content fails even with the correct format and dimensions', () => fixture(async job => {
  await convert(job);
  await sharp({ create: { width: 60, height: 39, channels: 3, background: '#000' } }).webp().toFile(path.join(job.output, 'input-60w.webp'));
  await assert.rejects(verify(job), /Output content differs from input/);
}));
test('extra output fails', () => fixture(async job => {
  await convert(job);
  await writeFile(path.join(job.output, 'extra.json'), '{}');
  await assert.rejects(verify(job), /Expected 2 images, found 3/);
}));
test('enlargement is disabled', () => fixture(async job => {
  job.widths = [960];
  await convert(job);
  const checked = await verify(job);
  assert.equal(checked.images[0].width, 121);
  assert.equal(checked.images[0].height, 79);
}));
test('EXIF orientation changes the expected output geometry', () => fixture(async (job, root) => {
  await sharp(job.input).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(root, 'rotated.jpg'));
  job.input = path.join(root, 'rotated.jpg');
  job.widths = [60];
  await convert(job);
  const checked = await verify(job);
  assert.deepEqual([checked.images[0].width, checked.images[0].height], [60, 92]);
}));
