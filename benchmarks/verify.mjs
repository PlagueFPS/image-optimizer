import sharp from 'sharp';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { expectations, settings } from './reference.mjs';

async function allFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await allFiles(file));
    else found.push(file);
  }
  return found.sort();
}

async function thumbnail(pipeline) {
  return pipeline.flatten({ background: '#fff' }).toColourspace('srgb').resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

export async function verify(job) {
  sharp.cache(false);
  sharp.concurrency(1);
  const expected = await expectations(job);
  const outputs = await allFiles(job.output);
  if (!expected.length || outputs.length !== expected.length) {
    throw new Error(`Expected ${expected.length} images, found ${outputs.length}`);
  }
  const pending = [];
  for (const item of expected) {
    const pipeline = sharp(item.input, { density: settings.svgDensity }).autoOrient();
    const alpha = await sharp(item.input, { density: settings.svgDensity }).autoOrient()
      .resize(item.width, item.height, { fit: 'fill', kernel: settings.kernel }).ensureAlpha().extractChannel('alpha').raw().toBuffer();
    pending.push({ ...item, alpha, needsAlpha: alpha.some(value => value < 255), thumbnail: await thumbnail(pipeline) });
  }
  const checked = [];
  for (const file of outputs) {
    const bytes = await readFile(file);
    const meta = await sharp(bytes, { failOn: 'warning' }).metadata();
    const { data, info } = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
    if (data.length !== info.width * info.height * info.channels) throw new Error(`Incomplete decode: ${file}`);
    const decodedThumbnail = await thumbnail(sharp(bytes));
    const candidates = pending.map((item, index) => ({ item, index })).filter(({ item }) => item.width === info.width && item.height === info.height &&
      (item.format === meta.format || item.format === 'avif' && meta.format === 'heif' && meta.compression === 'av1'));
    if (!candidates.length) throw new Error(`Unexpected format or geometry: ${file} ${meta.format} ${info.width}x${info.height}`);
    const actualAlpha = await sharp(bytes).ensureAlpha().extractChannel('alpha').raw().toBuffer();
    const scored = candidates.map(({ item, index }) => ({ index, source: item.input,
      missingAlpha: item.needsAlpha && !meta.hasAlpha,
      alphaRmse: Math.sqrt(actualAlpha.reduce((sum, value, offset) => sum + (value - item.alpha[offset]) ** 2, 0) / actualAlpha.length),
      rmse: Math.sqrt(decodedThumbnail.reduce((sum, value, offset) => sum + (value - item.thumbnail[offset]) ** 2, 0) / decodedThumbnail.length) }));
    const eligible = scored.filter(item => !item.missingAlpha && item.alphaRmse <= 5);
    if (!eligible.length) {
      if (scored.every(item => item.missingAlpha)) throw new Error(`Missing expected alpha: ${file}`);
      throw new Error(`Alpha plane differs from input: ${file}`);
    }
    const match = eligible.sort((a, b) => a.rmse - b.rmse)[0];
    if (match.rmse > 40) throw new Error(`Output content differs from input: ${file}, thumbnail RMSE ${match.rmse}`);
    const expectedAlpha = pending[match.index];
    const alphaRmse = match.alphaRmse;
    pending.splice(match.index, 1);
    checked.push({ file, source: match.source, thumbnail_rmse: match.rmse, width: info.width, height: info.height, format: meta.format,
      channels: info.channels, has_alpha: meta.hasAlpha, expected_nonopaque_alpha: expectedAlpha.needsAlpha, alpha_rmse: alphaRmse, bytes: (await stat(file)).size,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { count: checked.length, images: checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await verify(JSON.parse(await readFile(process.argv[2], 'utf8')))));
}
