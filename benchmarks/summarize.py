"""Combine complete groups from identical benchmark builds and retain provenance."""
import argparse
import collections
import json
from pathlib import Path
import statistics

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('reports', nargs='+', type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
reports = [json.loads(p.read_text()) for p in args.reports]
first = reports[0]
groups = {}
for path, report in zip(args.reports, reports):
    for key in ['harness_sha256', 'thread_environment', 'fixtures']:
        if report[key] != first[key]:
            raise ValueError(f'Mismatched {key}: {path}')
    if report['binary']['sha256'] != first['binary']['sha256']:
        raise ValueError(f'Mismatched binary: {path}')
    candidates = collections.defaultdict(list)
    for record in report['records']:
        candidates[record['case']].append(record)
    for case, records in candidates.items():
        if len(records) != 10:
            continue
        for side in ['rust', 'sharp']:
            values = [r for r in records if r['side'] == side]
            if len(values) != 5 or any(r.get('exit_code') != 0 or 'error' in r or 'verification' not in r for r in values):
                raise ValueError(f'Invalid completed group: {case}/{side}')
        if case in groups:
            raise ValueError(f'Duplicate complete group: {case}')
        groups[case] = records
if len(groups) != 21:
    raise ValueError(f'Expected 21 complete workloads, got {len(groups)}')
summary = []
for case, records in groups.items():
    row = {'case': case}
    for side in ['rust', 'sharp']:
        values = [r for r in records if r['side'] == side]
        row[side] = {}
        for key, series in [('wall_s', [r['wall_high_resolution_s'] for r in values]),
                            ('peak_rss_kib', [r['resources']['peak_rss_kib'] for r in values])]:
            row[side][key] = dict(median=statistics.median(series), minimum=min(series), maximum=max(series))
    summary.append(row)
result = dict(schema=1, scope='21 workloads, Linux WSL2, CPU1, Q80, effort6, pinned native runtime',
              sources=[str(p) for p in args.reports], binary=first['binary'],
              harness_sha256=first['harness_sha256'], thread_environment=first['thread_environment'],
              sharp=first['sharp'], fixtures=first['fixtures'], machine=first['machine'],
              summary=summary, records=[r for records in groups.values() for r in records])
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(f'{len(summary)} workloads, {len(result["records"])} successful processes')
