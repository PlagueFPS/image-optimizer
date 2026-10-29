#!/bin/sh
set -eu
cpu=${1:?usage: scaling.sh CPU images-or-directories}
group=${2:?usage: scaling.sh CPU images-or-directories}
case "$cpu" in 1|2|4|8|16) ;; *) echo 'CPU must be 1, 2, 4, 8 or 16' >&2; exit 2;; esac
case "$group" in
    images) set -- --case resize-noise --case convert-alpha --case preserve-alpha --case resize-translucent --case srcset-photo ;;
    directories) set -- --case directory-flat --case directory-recursive-srcset ;;
    *) echo 'group must be images or directories' >&2; exit 2;;
esac
python3 benchmarks/run.py --cpu "$cpu" --runs 5 --backend-notes probes/README.md \
    --results "benchmarks/results/scaling-cpu${cpu}-${group}" "$@"
