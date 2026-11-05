import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import time

parser = argparse.ArgumentParser(description='Measure built image CLIs with decoded output validation.')
parser.add_argument('config', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path.cwd()
config = json.loads(args.config.read_text())
root = args.output.resolve()
root.mkdir(parents=True, exist_ok=False)


def invoke(command, env):
    result = subprocess.run(list(map(str, command)), env=env, capture_output=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(json.dumps(dict(command=list(map(str, command)), exit=result.returncode,
                                          stderr=result.stderr.decode(errors='replace'))))
    return result.stdout


prepare = """
const sharp=require(process.cwd()+'/node_modules/sharp');const fs=require('node:fs');
(async()=>{const root=process.argv[1];fs.mkdirSync(root,{recursive:true});for(let i=0;i<12;i++){
await sharp('tests/fixtures/test.jpg').extract({left:i*12,top:i*8,width:3600,height:2400}).resize(1920).jpeg({quality:95}).toFile(`${root}/photo-${i}.jpg`);
await sharp('tests/fixtures/test2.png').modulate({brightness:0.8+i*.03}).png().toFile(`${root}/ui-${i}.png`);
}})().catch(e=>{console.error(e);process.exitCode=1});
"""
invoke(['node', '-e', prepare, root / 'corpus'], os.environ)

validator = """
const sharp=require(process.cwd()+'/node_modules/sharp');const fs=require('node:fs');const crypto=require('node:crypto');
(async()=>{const jobs=JSON.parse(fs.readFileSync(process.argv[1]));const results=[];
for(const j of jobs){const metadata=await sharp(j.output).metadata();let ref=sharp(j.source).rotate();
if(j.width)ref=ref.resize({width:j.width,withoutEnlargement:true});
const a=await ref.ensureAlpha().raw().toBuffer({resolveWithObject:true});
const b=await sharp(j.output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
if(a.info.width!==b.info.width||a.info.height!==b.info.height||a.data.length!==b.data.length||metadata.format!=='webp')throw Error('dimension or format mismatch');
let rgb=0,alpha=0;for(let i=0;i<a.data.length;i++){const d=a.data[i]-b.data[i];if(i%4===3)alpha+=d*d;else rgb+=d*d;}
const mse=rgb/(a.info.width*a.info.height*3);const psnr=10*Math.log10(255*255/mse);
if(psnr<20||alpha!==0)throw Error('quality or alpha mismatch '+psnr);
results.push({bytes:fs.statSync(j.output).size,width:metadata.width,height:metadata.height,psnr,alphaError:alpha,sha256:crypto.createHash('sha256').update(fs.readFileSync(j.output)).digest('hex')});}
console.log(JSON.stringify(results));})().catch(e=>{console.error(e);process.exitCode=1});
"""
cases = {
    'small': (repo / 'tests/fixtures/test2.png', [0]),
    'photo': (repo / 'tests/fixtures/test.jpg', [0]),
    'resize': (repo / 'tests/fixtures/test.jpg', [1280]),
    'batch': (root / 'corpus', [1280]),
    'sizes': (repo / 'tests/fixtures/test.jpg', [0, 384, 868, 1200]),
    'small-sizes': (repo / 'tests/fixtures/test2.png', [0, 128, 256, 384]),
    'help': (None, []),
    'version': (None, []),
}
sources = set()
for source, widths in cases.values():
    if source is not None:
        sources.update(map(str, source.iterdir())) if source.is_dir() else sources.add(str(source))
metadata_script = """
const sharp=require(process.cwd()+'/node_modules/sharp');
(async()=>{const result={};for(const p of process.argv.slice(1)){const m=await sharp(p).metadata();result[p]=m.autoOrient;}console.log(JSON.stringify(result));})().catch(e=>{console.error(e);process.exitCode=1});
"""
dimensions = json.loads(invoke(['node', '-e', metadata_script, *sorted(sources)], os.environ))
references = {}
rows = []


def measure(variant, case, round_number, prime=False):
    source, widths = cases[case]
    destination = root / f"{case}-{variant['name']}-{round_number}"
    destination.mkdir()
    env = dict(os.environ)
    for name in ['UV_THREADPOOL_SIZE', 'NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE']:
        env.pop(name, None)
    for key, value in variant.get('env', {}).items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = str(value)
    mode = variant.get('cache', 'disabled')
    if mode == 'disabled':
        env['NODE_DISABLE_COMPILE_CACHE'] = '1'
    else:
        directory = root / ('warm-cache-' + variant['name'] if mode == 'warm' else f"cold-cache-{case}-{variant['name']}-{round_number}")
        directory.mkdir(exist_ok=True)
        env['NODE_COMPILE_CACHE'] = str(directory)
    files = sorted(source.iterdir()) if source and source.is_dir() else [source] if source else []
    jobs = []
    for file in files:
        for width in widths:
            suffix = f'-{width}' if len(widths) > 1 and width else ''
            jobs.append(dict(source=str(file), output=str(destination / f'{file.stem}{suffix}.webp'), width=width))
    kind = variant.get('kind', 'img')
    command = variant.get('command', ['node', str(repo / json.loads((repo / 'package.json').read_text())['bin']['img'])])
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.perf_counter()
    if case in ['help', 'version']:
        stdout = invoke(command + ['--' + case], env)
        if not stdout.strip():
            raise RuntimeError('Empty help/version output')
    elif kind in ['img', 'control']:
        command = command + ['optimize', '-s', str(source), '-o', str(destination), '-f', 'webp', '-q', '80', '-e', '4', '--yes', '--summary-json'] + variant.get('flags', [])
        if len(widths) > 1:
            command += ['--sizes', ','.join(map(str, widths[1:]))]
        elif widths[0]:
            command += ['--width', str(widths[0])]
        report = json.loads(invoke(command, env))
        summary = report['summary']
        if summary['optimized'] != len(jobs) or summary['failed'] or summary['skipped']:
            raise RuntimeError('Unexpected report counts')
    else:
        def one(job):
            cmd = command + [job['source']]
            if kind == 'cwebp':
                cmd = command + ['-quiet', '-q', '80', '-m', '4']
                if len(jobs) == 1:
                    cmd += ['-mt']
                if job['width'] and job['width'] < dimensions[job['source']]['width']:
                    height = max(1, int(job['width'] * dimensions[job['source']]['height'] / dimensions[job['source']]['width'] + .5))
                    cmd += ['-resize', str(job['width']), str(height)]
                cmd += [job['source'], '-o', job['output']]
            else:
                cmd += ['-auto-orient', '-strip']
                if job['width']:
                    cmd += ['-resize', str(job['width']) + 'x>']
                cmd += ['-quality', '80', '-define', 'webp:method=4', '-define', 'webp:alpha-quality=100', '-define', 'webp:thread-level=' + str(int(len(jobs) == 1)), job['output']]
            invoke(cmd, env)
        with concurrent.futures.ThreadPoolExecutor(max_workers=variant.get('workers', 12)) as pool:
            list(pool.map(one, jobs))
    seconds = time.perf_counter() - start
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    manifest = destination / 'manifest.json'
    manifest.write_text(json.dumps(jobs))
    outputs = json.loads(invoke(['node', '-e', validator, str(manifest)], os.environ)) if jobs else []
    hashes = [item['sha256'] for item in outputs]
    if kind == 'img':
        if case not in references:
            references[case] = hashes
        elif references[case] != hashes:
            raise RuntimeError(f'Output changed for {variant["name"]}/{case}')
    row = dict(case=case, variant=variant['name'], round=round_number, prime=prime, seconds=seconds,
               cpu_seconds=after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,
               optimized=len(outputs), failures=0, output_bytes=sum(x['bytes'] for x in outputs), outputs=outputs)
    with (root / 'runs.jsonl').open('a') as file:
        file.write(json.dumps(row)+'\n')
    print(json.dumps({key: value for key, value in row.items() if key != 'outputs'}), flush=True)
    return row


try:
    for case in config['cases']:
        for variant in config['variants']:
            if variant.get('cache') == 'warm':
                measure(variant, case, 'prime', True)
        for round_number in range(config.get('rounds', 5)):
            variants = config['variants']
            offset = round_number % len(variants)
            for variant in variants[offset:] + variants[:offset]:
                rows.append(measure(variant, case, round_number))
    summary = []
    for case in config['cases']:
        for variant in config['variants']:
            subset = [r for r in rows if r['case'] == case and r['variant'] == variant['name']]
            times = [r['seconds'] for r in subset]
            summary.append(dict(case=case, variant=variant['name'], n=len(times), median=statistics.median(times),
                                minimum=min(times), maximum=max(times), optimized=sum(r['optimized'] for r in subset),
                                failures=sum(r['failures'] for r in subset)))
    (root / 'summary.json').write_text(json.dumps(summary, indent=2))
    (root / 'config.json').write_text(json.dumps(config, indent=2))
    (root / 'runs.json').write_text(json.dumps(rows, indent=2))
except Exception as error:
    (root / 'failure.txt').write_text(str(error))
    raise
