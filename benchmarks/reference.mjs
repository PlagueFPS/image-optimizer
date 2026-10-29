import sharp from 'sharp';
import { readdir, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const settings = {
  kernel: 'lanczos3', withoutEnlargement: true, autoOrient: true,
  svgDensity: 72, cache: false, fileConcurrency: 1,
  webp: { alphaQuality: 100, lossless: false, nearLossless: false, smartSubsample: false },
  jpeg: { optimiseCoding: true, progressive: false, chromaSubsampling: '4:2:0', mozjpeg: false },
  png: { compressionLevel: 6, adaptiveFiltering: true, palette: false },
  avif: { chromaSubsampling: '4:2:0', bitdepth: 8, lossless: false, tune: 'ssim' },
};

export async function files(input, recursive) {
  if (!(await stat(input)).isDirectory()) return [input];
  const result = [];
  for (const entry of (await readdir(input, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(input, entry.name);
    if (entry.isDirectory() && recursive) result.push(...await files(file, true));
    else if (entry.isFile() && /\.(jpe?g|png|avif|svg)$/i.test(entry.name)) result.push(file);
  }
  return result;
}

export function outputFormat(input, format) {
  if (format === 'webp') return 'webp';
  const ext = path.extname(input).slice(1).toLowerCase();
  if (ext === 'svg') throw new Error('Preserve SVG resize has no raster encoder contract');
  return ext === 'jpg' ? 'jpeg' : ext;
}

export async function expectations(job) {
  const entries = [];
  for (const input of await files(job.input, job.recursive)) {
    const meta = await sharp(input, { density: settings.svgDensity }).metadata();
    const swap = [5, 6, 7, 8].includes(meta.orientation);
    const sourceWidth = swap ? meta.height : meta.width;
    const sourceHeight = swap ? meta.width : meta.height;
    for (const requested of job.widths.length ? job.widths : [null]) {
      const width = requested ? Math.min(requested, sourceWidth) : sourceWidth;
      entries.push({ input, requested, width, height: Math.max(1, Math.round(sourceHeight * width / sourceWidth)),
        format: outputFormat(input, job.format) });
    }
  }
  return entries;
}

export async function convert(job) {
  sharp.cache(false);
  sharp.concurrency(job.cpu);
  const directory = (await stat(job.input)).isDirectory();
  const outputs = [];
  for (const input of await files(job.input, job.recursive)) {
    for (const requested of job.widths.length ? job.widths : [null]) {
      const item = { input, requested, format: outputFormat(input, job.format) };
      const relative = directory ? path.relative(job.input, item.input) : path.basename(item.input);
      const parsed = path.parse(relative);
      const suffix = item.requested ? `-${item.requested}w` : '';
      const ext = item.format === 'jpeg' ? 'jpg' : item.format;
      const output = path.join(job.output, parsed.dir, `${parsed.name}${suffix}.${ext}`);
      await mkdir(path.dirname(output), { recursive: true });
      let pipeline = sharp(item.input, { density: settings.svgDensity }).autoOrient();
      if (item.requested) pipeline = pipeline.resize({ width: item.requested, withoutEnlargement: true, kernel: settings.kernel });
      const options = { ...settings[item.format] };
      if (item.format !== 'png') options.quality = job.quality;
      if (['webp', 'avif'].includes(item.format)) options.effort = job.effort;
      await pipeline.toFormat(item.format, options).toFile(output);
      outputs.push(output);
    }
  }
  return { outputs, concurrency: sharp.concurrency(), versions: sharp.versions, settings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--versions') console.log(JSON.stringify({ node: process.version, versions: sharp.versions, settings }));
  else console.log(JSON.stringify(await convert(JSON.parse(await readFile(process.argv[2], 'utf8')))));
}
