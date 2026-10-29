"""Run scaling batches serially and resume completed batches after interruption."""
import json
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parent.parent
for cpu in [1, 16, 2, 8, 4]:
    for group in ['images', 'directories']:
        directory = root / 'benchmarks/results' / f'scaling-cpu{cpu}-{group}'
        if directory.exists():
            path = directory / 'results.json'
            report = json.loads(path.read_text()) if path.exists() else {}
            if report.get('completed') and not report.get('errors'):
                print(f'Completed: cpu={cpu} {group}', flush=True)
                continue
            directory.rename(directory.with_name(directory.name + '-interrupted-' + str(time.time_ns())))
        print(f'Running: cpu={cpu} {group}', flush=True)
        subprocess.run(['sh', 'benchmarks/scaling.sh', str(cpu), group], cwd=root, check=True)
subprocess.run(['python3', 'benchmarks/summarize-scaling.py'], cwd=root, check=True)
