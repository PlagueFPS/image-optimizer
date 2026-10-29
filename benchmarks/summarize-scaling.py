"""Validate the complete scaling matrix and summarize latency, RSS and CPU use."""
import json
from pathlib import Path
import statistics

root = Path(__file__).resolve().parent
reports = []
rows = []
for cpu in [1, 2, 4, 8, 16]:
    for group in ['images', 'directories']:
        path = root / 'results' / f'scaling-cpu{cpu}-{group}' / 'results.json'
        report = json.loads(path.read_text())
        if not report.get('completed') or report['errors']:
            raise ValueError(f'Incomplete or failed batch: {path}')
        if report['args']['cpu'] != cpu:
            raise ValueError(f'Wrong CPU setting: {path}')
        if reports:
            for key in ['adapter.py', 'run.py', 'reference.mjs', 'verify.mjs', 'fixtures.mjs', 'package-lock.json']:
                if report['harness_sha256'][key] != reports[0]['harness_sha256'][key]:
                    raise ValueError(f'Mismatched measured script {key}: {path}')
            if report['fixtures'] != reports[0]['fixtures']:
                raise ValueError(f'Mismatched fixtures: {path}')
            if report['binary']['sha256'] != reports[0]['binary']['sha256']:
                raise ValueError(f'Binary changed: {path}')
        reports.append(report)
        for record in report['records']:
            if record.get('exit_code') != 0 or 'error' in record or 'verification' not in record:
                raise ValueError(f'Invalid observation: {record}')
            rows.append({**record, 'cpu': cpu, 'batch': str(path.relative_to(root))})
summary = []
for case in sorted({row['case'] for row in rows}):
    for cpu in [1, 2, 4, 8, 16]:
        for side in ['rust', 'sharp']:
            selected = [r for r in rows if (r['case'], r['cpu'], r['side']) == (case, cpu, side)]
            if len(selected) != 5:
                raise ValueError(f'Expected five observations: {case}/{cpu}/{side}')
            metrics = {
                'wall_s': [r['wall_high_resolution_s'] for r in selected],
                'peak_rss_mib': [r['resources']['peak_rss_kib'] / 1024 for r in selected],
                'busy_cores': [(r['resources']['user_s'] + r['resources']['system_s']) / r['wall_high_resolution_s'] for r in selected],
                'cpu_s': [r['resources']['user_s'] + r['resources']['system_s'] for r in selected],
            }
            summary.append(dict(case=case, cpu=cpu, side=side, **{
                key: dict(median=statistics.median(values), minimum=min(values), maximum=max(values))
                for key, values in metrics.items()}))
for item in summary:
    baseline = next(x for x in summary if x['case'] == item['case'] and x['side'] == item['side'] and x['cpu'] == 1)
    item['speedup_vs_one'] = baseline['wall_s']['median'] / item['wall_s']['median']
result = dict(schema=1, claim='Measured libvips worker scaling, not CPU affinity or file-level parallelism.',
              cpus=[1, 2, 4, 8, 16], binary=reports[0]['binary'],
              harness_sha256=reports[0]['harness_sha256'], fixtures=reports[0]['fixtures'],
              machine=reports[0]['machine'], sharp=reports[0]['sharp'],
              batches=[dict(args=r['args'], started=r['started'], thread_environment=r['thread_environment']) for r in reports],
              summary=summary, records=rows,
              successful_processes=len(rows), decoded_outputs=sum(len(r['verification']['images']) for r in rows))
output = root / 'evidence' / 'multicore-scaling.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(f'{len(summary)} groups, {len(rows)} processes, {result["decoded_outputs"]} decoded outputs: {output}')
