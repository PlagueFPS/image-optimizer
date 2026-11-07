---
"@plaguefps/img": patch
---

Allow `--move` after the primary output and all eligible variants succeed when an oversized variant is rejected without `--upscale`. Keep the rejected result failed and exit with code 1, while every result reports the moved source and its archive destination.
