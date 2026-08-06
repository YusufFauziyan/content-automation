#!/bin/sh
# Dev-only wrapper: see ffmpeg-docker.sh.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec docker run --rm -v "$PROJECT_DIR/output:$PROJECT_DIR/output" yu-ffmpeg ffprobe "$@"
