#!/usr/bin/env python3
"""Read versions from the dynamic libraries in this process's loader environment."""
import ctypes
import hashlib
import json
from pathlib import Path

versions = {}
for library, symbol in [('libvips.so.42', 'vips_version_string'),
                        ('libheif.so.1', 'heif_get_version'),
                        ('libz.so.1', 'zlibVersion'),
                        ('libdav1d.so.7', 'dav1d_version')]:
    try:
        function = getattr(ctypes.CDLL(library), symbol)
        function.restype = ctypes.c_char_p
        versions[library] = function().decode()
    except OSError as error:
        versions[library] = str(error)
webp = ctypes.CDLL('libwebp.so.7').WebPGetEncoderVersion()
versions['libwebp.so.7'] = '.'.join(str(webp >> shift & 255) for shift in [16, 8, 0])
files = sorted({line.split()[-1] for line in Path('/proc/self/maps').read_text().splitlines()
                if '.so' in line and line.split()[-1].startswith('/')})
print(json.dumps({'versions': versions, 'libraries': {file: hashlib.sha256(Path(file).read_bytes()).hexdigest() for file in files}}, indent=2))
