# Image Optimizer CLI
This is an Effect-native command-line interface (CLI) tool designed to optimize images for applications. It supports various image formats including JPEG, PNG, GIF, and SVG, and provides options for resizing, compressing, and converting images to different formats.

## Tooling
This project uses [`vite-plus`](https://viteplus.dev/llms.txt) as our unified toolchain.

## Verification
After making code changes and before handing back to the user, run the following command(s) to verify the codebase:

```bash
vp check # Lints, Formats, and Typechecks
vp test # Runs the test suite - only run if you made changes that affect application behavior
```

