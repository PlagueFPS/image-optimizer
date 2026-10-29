"""Collect untimed high-worker native profiles and verify their outputs."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
report = json.loads((root / 'benchmarks/evidence/multicore-scaling.json').read_text())
out = root / 'benchmarks/results/scaling-profiles'
out.mkdir(exist_ok=True)
evidence = root / 'benchmarks/evidence/scaling-profiles'
evidence.mkdir(exist_ok=True)
perf = '/tmp/image-bench-audit/tools/usr/bin/perf'
env = {**os.environ, 'VIPS_CONCURRENCY': '16', 'UV_THREADPOOL_SIZE': '16', 'RAYON_NUM_THREADS': '16', 'OMP_NUM_THREADS': '16', 'SHARP_IGNORE_GLOBAL_LIBVIPS': '1'}
env['LD_LIBRARY_PATH'] += ':/tmp/image-bench-audit/tools/usr/lib/x86_64-linux-gnu'
for case in ['convert-alpha', 'preserve-alpha', 'resize-translucent']:
    for side in ['rust', 'sharp']:
        record = next(r for r in report['records'] if (r['case'], r['side'], r['cpu']) == (case, side, 16))
        label = f'{case}-{side}-cpu16'
        job = {**record['job'], 'output': str(out / label)}
        path = out / f'{label}.job.json'
        path.write_text(json.dumps(job))
        if side == 'rust':
            command = record['command'].copy()
            command[command.index('--out-dir') + 1] = job['output']
        else:
            command = ['node', str(root / 'benchmarks/reference.mjs'), str(path)]
        data = out / f'{label}.data'
        with (out / f'{label}.stdout').open('w') as stdout, (out / f'{label}.stderr').open('w') as stderr:
            subprocess.run([perf, 'record', '-F', '999' if case == 'preserve-alpha' else '199', '-e', 'cpu-clock:u', '--call-graph', 'dwarf,8192', '-o', str(data), '--', *command], env=env, stdout=stdout, stderr=stderr, check=True)
        for sort in ['dso', 'dso,symbol']:
            with (evidence / f'{label}-{sort}.txt').open('w') as target:
                subprocess.run([perf, 'report', '--stdio', '--no-children', '--call-graph', 'none', '--percent-limit', '1', '--sort', sort, '-n', '-i', str(data)], env=env, stdout=target, stderr=subprocess.STDOUT, check=True)
        verified = subprocess.check_output(['node', str(root / 'benchmarks/verify.mjs'), str(path)], env=env, text=True)
        (evidence / f'{label}-verified.json').write_text(verified)
        print(label, flush=True)
