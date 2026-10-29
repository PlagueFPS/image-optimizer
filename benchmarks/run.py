#!/usr/bin/env python3
"""Fresh-process end-to-end measurements. No performance verdict is inferred."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import statistics
import subprocess
import time
import threading

from adapter import rust_command

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def capture(command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{command}: {result.stderr}')
    return result.stdout.strip()


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def workloads():
    cases = []
    for file in ['generated/noise.jpg', 'generated/alpha.png', 'generated/translucent.avif',
                 'generated/vector.svg', 'photos/earth.jpg', 'photos/astronaut.png']:
        name = Path(file).stem
        cases += [dict(name=f'convert-{name}', source=file, widths=[], format='webp'),
                  dict(name=f'resize-{name}', source=file, widths=[960], format='webp')]
        if not file.endswith('.svg'):
            cases.append(dict(name=f'preserve-{name}', source=file, widths=[480], format='preserve'))
    cases += [dict(name='srcset-photo', source='photos/earth.jpg', widths=[480, 960, 1920], format='webp'),
              dict(name='resize-exif6-photo', source='photos/earth-exif6.jpg', widths=[960], format='webp'),
              dict(name='directory-flat', source='flat', widths=[], format='webp'),
              dict(name='directory-recursive-srcset', source='recursive', widths=[480, 960], format='webp', recursive=True)]
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=ROOT / 'target/release/image-optimizer')
    parser.add_argument('--skip-build', action='store_true', help='Require a separately built release binary')
    parser.add_argument('--sharp-only', action='store_true', help='Validate reference only; never a comparison')
    parser.add_argument('--runs', type=int, default=5)
    parser.add_argument('--cpu', type=int, default=1)
    parser.add_argument('--quality', type=int, default=80)
    parser.add_argument('--effort', type=int, default=6)
    parser.add_argument('--case', action='append', default=[], help='Exact case name, repeatable')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--results', type=Path)
    parser.add_argument('--backend-notes', type=Path, help='Rust codec versions, geometry, threading and encoder evidence')
    args = parser.parse_args()
    if args.runs < 5 or args.cpu < 1 or not 1 <= args.quality <= 100 or not 0 <= args.effort <= 6 or args.timeout < 1:
        parser.error('Require runs >= 5, cpu >= 1, quality 1..100, effort 0..6, timeout >= 1')
    cases = [case for case in workloads() if not args.case or case['name'] in args.case]
    if not cases or set(args.case) - {c['name'] for c in cases}:
        parser.error('Unknown case. Available: ' + ', '.join(c['name'] for c in workloads()))
    result_dir = (args.results or HERE / 'results' / time.strftime('%Y%m%dT%H%M%S')).resolve()
    result_dir.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, 'SHARP_IGNORE_GLOBAL_LIBVIPS': '1', 'UV_THREADPOOL_SIZE': str(args.cpu),
           'VIPS_CONCURRENCY': str(args.cpu), 'RAYON_NUM_THREADS': str(args.cpu),
           'OMP_NUM_THREADS': str(args.cpu)}
    report = dict(schema=1, acceptance='pending', verdict='inconclusive',
                  claim='Compare end-to-end latency and peak RSS only after option matching, profiling and output checks.',
                  args=vars(args).copy(), records=[], errors=[],
                  started=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    report['args'] = {k: str(v) if isinstance(v, Path) else v for k, v in report['args'].items()}

    def save():
        (result_dir / 'results.json').write_text(json.dumps(report, indent=2) + '\n')

    try:
        report['machine'] = dict(platform=platform.platform(), cpu_count=os.cpu_count(),
                                 affinity=sorted(os.sched_getaffinity(0)), load=os.getloadavg(),
                                 uptime=capture(['uptime']), cpu_info=Path('/proc/cpuinfo').read_text(),
                                 memory_info=Path('/proc/meminfo').read_text())
        report['environment_build_flags'] = {key: os.environ.get(key) for key in ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_TARGET', 'CARGO_PROFILE_RELEASE_OPT_LEVEL', 'CARGO_PROFILE_RELEASE_LTO', 'CARGO_PROFILE_RELEASE_DEBUG']}
        report['toolchain'] = dict(rustc=capture(['rustc', '-Vv']), cargo=capture(['cargo', '-V']))
        report['git_head'] = capture(['git', 'rev-parse', 'HEAD'], cwd=ROOT)
        report['git_status'] = capture(['git', 'status', '--short'], cwd=ROOT)
        report['sharp'] = json.loads(capture(['node', str(HERE / 'reference.mjs'), '--versions'], env=env))
        report['time_version'] = capture(['/usr/bin/time', '--version'])
        report['harness_sha256'] = {p.name: digest(p) for p in HERE.iterdir() if p.suffix in ['.mjs', '.py'] or p.name == 'package-lock.json'}
        manifest = json.loads((HERE / 'fixtures/manifest.json').read_text())
        for item in manifest['files']:
            if digest(HERE / 'fixtures' / item['path']) != item['sha256']:
                raise ValueError(f'Fixture hash changed: {item["path"]}')
        report['fixtures'] = manifest
        report['all_fixture_hashes'] = {str(p.relative_to(HERE / 'fixtures')): digest(p)
                                         for p in sorted((HERE / 'fixtures').rglob('*')) if p.is_file()}
        report['thread_environment'] = {k: env[k] for k in ['SHARP_IGNORE_GLOBAL_LIBVIPS', 'UV_THREADPOOL_SIZE', 'VIPS_CONCURRENCY', 'RAYON_NUM_THREADS', 'OMP_NUM_THREADS']}
        if args.backend_notes:
            report['rust_backend_notes'] = args.backend_notes.read_text()
        binary = args.binary.resolve()
        if not args.sharp_only:
            if not args.skip_build:
                if binary != ROOT / 'target/release/image-optimizer':
                    raise ValueError('Custom --binary requires --skip-build and release provenance in --backend-notes')
                report['build_command'] = ['cargo', 'build', '--release', '--locked', '--bin', 'image-optimizer', '--target-dir', str(ROOT / 'target')]
                report['build'] = capture(report['build_command'], cwd=ROOT)
            if not binary.is_file():
                raise ValueError('Release binary unavailable')
            help_text = capture([str(binary), '--help'])
            report['binary'] = dict(path=str(binary), sha256=digest(binary), help=help_text,
                                    version=capture([str(binary), '--version']))
            if '--out-dir' not in help_text or '--widths' not in help_text:
                raise ValueError('Production CLI contract unavailable. Revise adapter.py only after integration.')
            report['rust_dependencies'] = capture(['cargo', 'tree', '--locked'], cwd=ROOT)
        save()
        for case_index, case in enumerate(cases):
            for iteration in range(args.runs):
                sides = ['sharp'] if args.sharp_only else (['rust', 'sharp'] if case_index % 2 == 0 else ['sharp', 'rust'])
                for side in sides:
                    label = f'{case["name"]}-{iteration + 1}-{side}'
                    output = result_dir / label
                    output.mkdir()
                    job = dict(input=str(HERE / 'fixtures' / case['source']), output=str(output),
                               recursive=case.get('recursive', False), widths=case['widths'], format=case['format'],
                               quality=args.quality, effort=args.effort, cpu=args.cpu)
                    job_file = result_dir / f'{label}.job.json'
                    job_file.write_text(json.dumps(job))
                    command = rust_command(binary, job) if side == 'rust' else ['node', str(HERE / 'reference.mjs'), str(job_file)]
                    timing = result_dir / f'{label}.time.json'
                    timed = ['/usr/bin/time', '-f', '{"elapsed_s":%e,"user_s":%U,"system_s":%S,"peak_rss_kib":%M,"exit_code":%x}', '-o', str(timing), *command]
                    record = dict(case=case['name'], iteration=iteration + 1, side=side, command=command,
                                  load_before=os.getloadavg(), job=job)
                    report['records'].append(record)
                    print(label, flush=True)
                    start = time.perf_counter()
                    with (result_dir / f'{label}.stdout').open('w') as stdout, (result_dir / f'{label}.stderr').open('w') as stderr:
                        process = subprocess.Popen(timed, stdout=stdout, stderr=stderr, env=env, start_new_session=True)
                        timed_out = threading.Event()

                        def kill_group():
                            timed_out.set()
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass

                        timer = threading.Timer(args.timeout, kill_group)
                        timer.start()
                        try:
                            record['exit_code'] = process.wait()
                            record['wall_high_resolution_s'] = time.perf_counter() - start
                        except BaseException:
                            kill_group()
                            process.wait()
                            raise
                        finally:
                            timer.cancel()
                            timer.join()
                        if timed_out.is_set():
                            record['error'] = 'timeout; entire process group killed'
                    record['load_after'] = os.getloadavg()
                    if timing.exists():
                        lines = timing.read_text().splitlines()
                        record['gnu_time_raw'] = lines
                        for line in reversed(lines):
                            try:
                                record['resources'] = json.loads(line)
                                break
                            except json.JSONDecodeError:
                                pass
                    if record.get('exit_code') != 0:
                        record['error'] = record.get('error', 'nonzero child exit')
                    else:
                        try:
                            record['verification'] = json.loads(capture(['node', str(HERE / 'verify.mjs'), str(job_file)], env=env, timeout=args.timeout))
                        except Exception as error:
                            record['error'] = str(error)
                    save()
        groups = {}
        for record in report['records']:
            if 'error' in record or 'resources' not in record:
                report['errors'].append(record)
                continue
            groups.setdefault((record['case'], record['side']), []).append(record)
        report['summary'] = []
        for (case, side), records in groups.items():
            summary = dict(case=case, side=side, successful_runs=len(records))
            for key, values in [('wall_s', [r['wall_high_resolution_s'] for r in records]),
                                ('peak_rss_kib', [r['resources']['peak_rss_kib'] for r in records])]:
                summary[key] = dict(median=statistics.median(values), minimum=min(values), maximum=max(values))
            report['summary'].append(summary)
        report['completed'] = True
    except Exception as error:
        report['errors'].append(str(error))
    save()
    print(f'Results: {result_dir / "results.json"}; acceptance pending, verdict inconclusive')
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
