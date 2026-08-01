#!/bin/sh
# Dev-only wrapper: runs FFmpeg inside the `yu-ffmpeg` image, which is built
# with libass (needed to burn subtitles). Homebrew's ffmpeg is not.
#
# The output directory is mounted at its own absolute path, so every path in
# the command line resolves identically inside and outside the container.
# Point FFMPEG_PATH at this script to use it; unset it on a machine whose
# native ffmpeg includes libass.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec docker run --rm -v "$PROJECT_DIR/output:$PROJECT_DIR/output" yu-ffmpeg ffmpeg "$@"
