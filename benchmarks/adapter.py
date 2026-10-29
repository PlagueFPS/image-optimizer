"""Only this module knows the production CLI argument contract."""

def rust_command(binary, job):
    command = [str(binary), job['input'], '--out-dir', job['output'],
               '--format', job['format'], '--quality', str(job['quality']),
               '--effort', str(job['effort']), '--cpu', str(job['cpu']), '--json']
    if job['recursive']:
        command.append('--recursive')
    if len(job['widths']) == 1:
        command += ['--width', str(job['widths'][0])]
    elif job['widths']:
        command += ['--widths', ','.join(map(str, job['widths']))]
    return command
