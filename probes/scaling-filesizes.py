"""Summarize verified encoded sizes without changing timed benchmark programs."""
import collections
import json
from pathlib import Path
import statistics

root = Path(__file__).resolve().parent.parent
report = json.loads((root / 'benchmarks/evidence/multicore-scaling.json').read_text())
summaries = []
for case in sorted({r['case'] for r in report['records']}):
    for cpu in report['cpus']:
        row = dict(case=case, cpu=cpu)
        for side in ['rust', 'sharp']:
            records = [r for r in report['records'] if (r['case'], r['cpu'], r['side']) == (case, cpu, side)]
            totals = [sum(image['bytes'] for image in r['verification']['images']) for r in records]
            images = collections.defaultdict(list)
            for record in records:
                for image in record['verification']['images']:
                    key = (image['source'], image['width'], image['height'], image['format'])
                    images[key].append(image)
            row[side] = dict(total_bytes=dict(median=statistics.median(totals), minimum=min(totals), maximum=max(totals)),
                             images=[dict(source=k[0], width=k[1], height=k[2], format=k[3],
                                          bytes_min=min(i['bytes'] for i in values), bytes_max=max(i['bytes'] for i in values),
                                          sha256=sorted({i['sha256'] for i in values})) for k, values in sorted(images.items())])
        row['rust_minus_sharp_bytes'] = row['rust']['total_bytes']['median'] - row['sharp']['total_bytes']['median']
        row['rust_minus_sharp_percent'] = 100 * row['rust_minus_sharp_bytes'] / row['sharp']['total_bytes']['median']
        summaries.append(row)
changes = []
for case in sorted({r['case'] for r in summaries}):
    for side in ['rust', 'sharp']:
        rows = [r for r in summaries if r['case'] == case]
        signatures = {tuple((i['source'], i['width'], i['height'], i['format'], i['bytes_min'], i['bytes_max']) for i in r[side]['images']) for r in rows}
        changes.append(dict(case=case, side=side, sizes_stable_across_workers=len(signatures) == 1,
                            byte_identical_across_runs_and_workers=all(len({h for r in rows for i in r[side]['images'] if (i['source'],i['width'],i['height'],i['format']) == key for h in i['sha256']}) == 1 for key in {(i['source'],i['width'],i['height'],i['format']) for r in rows for i in r[side]['images']})))
result = dict(schema=1, source='benchmarks/evidence/multicore-scaling.json', summary=summaries, stability=changes)
output = root / 'benchmarks/evidence/multicore-filesizes.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(output)
