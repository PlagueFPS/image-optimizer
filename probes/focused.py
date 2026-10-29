#!/usr/bin/env python3
"""Focused fresh-process comparisons using the unchanged independent verifier."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import sys
import subprocess
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--benchmarks', type=Path, required=True)
p.add_argument('--binary', type=Path, required=True)
p.add_argument('--results', type=Path, required=True)
p.add_argument('--optimized-prefix', type=Path, required=True)
p.add_argument('--plugin-prefix', type=Path, required=True)
p.add_argument('--runs', type=int, default=5)
p.add_argument('--before-binary', type=Path)
p.add_argument('--heif-prefix', type=Path)
p.add_argument('--case', action='append', required=True)
a = p.parse_args()
if a.runs < 5:
    p.error('Require at least five runs per side')
a.results.mkdir(parents=True, exist_ok=False)
bench = a.benchmarks.resolve()
base = {**os.environ, 'VIPS_CONCURRENCY': '1', 'UV_THREADPOOL_SIZE': '1',
        'OMP_NUM_THREADS': '1', 'RAYON_NUM_THREADS': '1'}
base.pop('MALLOC_ARENA_MAX', None)
tuned = {'LD_LIBRARY_PATH': f'{a.optimized_prefix.resolve()}/lib:{a.plugin_prefix.resolve()}/usr/lib/x86_64-linux-gnu:' + base['LD_LIBRARY_PATH'],
         'LIBHEIF_PLUGIN_PATH': str(a.plugin_prefix.resolve() / 'usr/lib/x86_64-linux-gnu/libheif/plugins')}
if a.heif_prefix:
    tuned['LD_LIBRARY_PATH'] = str(a.heif_prefix.resolve() / 'lib') + ':' + tuned['LD_LIBRARY_PATH']
    tuned['LIBHEIF_PLUGIN_PATH'] = str(a.heif_prefix.resolve() / 'lib/libheif')
cases = {'directory-flat': ('flat', [], 'webp', False),
         'directory-recursive-srcset': ('recursive', [480, 960], 'webp', True),
         'convert-alpha': ('generated/alpha.png', [], 'webp', False),
         'preserve-alpha': ('generated/alpha.png', [480], 'preserve', False),
         'convert-translucent': ('generated/translucent.avif', [], 'webp', False),
         'resize-translucent': ('generated/translucent.avif', [960], 'webp', False),
         'preserve-translucent': ('generated/translucent.avif', [480], 'preserve', False)}
report = {'claim': 'Isolate allocator and native codec changes with decoded outputs at unchanged quality and effort.',
          'binary_sha256': hashlib.sha256(a.binary.read_bytes()).hexdigest(),
          'before_binary_sha256': hashlib.sha256(a.before_binary.read_bytes()).hexdigest() if a.before_binary else None,
          'load': os.getloadavg(), 'environment': {k: base.get(k) for k in ['LD_LIBRARY_PATH', 'VIPSHOME', 'VIPS_CONCURRENCY', 'UV_THREADPOOL_SIZE', 'OMP_NUM_THREADS', 'RAYON_NUM_THREADS']},
          'tuned_environment': tuned, 'records': []}
report['provenance'] = {'source': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path('src/backend.rs'), Path('src/main.rs'), Path(__file__)]}, 'native': {label: json.loads(subprocess.check_output([sys.executable, str(Path(__file__).with_name('native_versions.py'))], env={**base, **overrides}, text=True)) for label, overrides in [('default', {}), ('tuned', tuned)]}, 'fixture_manifest': json.loads((bench / 'fixtures/manifest.json').read_text()), 'toolchain': subprocess.check_output(['rustc', '-Vv'], text=True)}
for case in a.case:
    source, widths, fmt, recursive = cases[case]
    sides = ['arena128', 'default', 'tuned', 'sharp'] if case == 'directory-flat' else ['default', 'tuned', 'sharp']
    if a.before_binary:
        sides.insert(0, 'before')
    for iteration in range(a.runs):
        for side in sides if iteration % 2 == 0 else list(reversed(sides)):
            label = f'{case}-{iteration}-{side}'
            out = a.results / label
            job = {'input': str(bench / 'fixtures' / source), 'output': str(out.resolve()), 'widths': widths, 'format': fmt, 'recursive': recursive, 'cpu': 1, 'quality': 80, 'effort': 6}
            jobfile = a.results / f'{label}.job.json'
            jobfile.write_text(json.dumps(job))
            env = {**base, **(tuned if side == 'tuned' else {})}
            if side == 'arena128':
                env['MALLOC_ARENA_MAX'] = '128'
            if side == 'sharp':
                command = ['node', str(bench / 'reference.mjs'), str(jobfile.resolve())]
            else:
                command = [str((a.before_binary if side == 'before' else a.binary).resolve()), job['input'], '--out-dir', job['output'], '--format', fmt, '--cpu', '1', '--quality', '80', '--effort', '6', '--json']
                if recursive:
                    command += ['--recursive']
                if widths:
                    command += ['--widths', ','.join(map(str, widths))]
            timer = a.results / f'{label}.time'
            start = time.perf_counter()
            result = subprocess.run(['/usr/bin/time', '-f', '%e %U %S %M', '-o', str(timer), *command], env=env, capture_output=True, text=True, timeout=180)
            elapsed = time.perf_counter() - start
            (a.results / f'{label}.stdout').write_text(result.stdout)
            (a.results / f'{label}.stderr').write_text(result.stderr)
            result.check_returncode()
            resources = list(map(float, timer.read_text().split()))
            verify = subprocess.run(['node', str(bench / 'verify.mjs'), str(jobfile.resolve())], env=base, capture_output=True, text=True, check=True)
            row = dict(case=case, iteration=iteration, side=side, command=command, wall_s=elapsed, user_s=resources[1], system_s=resources[2], rss_kib=resources[3], verification=json.loads(verify.stdout), load=os.getloadavg())
            report['records'].append(row)
            (a.results / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
            print(label, round(elapsed, 3), resources[2:], flush=True)
report['summary'] = []
for case in a.case:
    for side in ['before', 'arena128', 'default', 'tuned', 'sharp']:
        rows = [r for r in report['records'] if r['case'] == case and r['side'] == side]
        if rows:
            report['summary'].append({'case': case, 'side': side, **{key: {'median': statistics.median([r[key] for r in rows]), 'min': min(r[key] for r in rows), 'max': max(r[key] for r in rows)} for key in ['wall_s', 'system_s', 'rss_kib']}})
(a.results / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
