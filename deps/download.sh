#!/usr/bin/env bash

set -ex

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/refs.sh"
source "$SCRIPT_DIR/hashes.sh"

# clone_at_commit <dir> <commit> <url> [fallback url...]
# Retries each url a few times as CI runners occasionally fail to reach a host.
clone_at_commit() {
    local dir="$1" commit="$2"
    shift 2
    if [ -d "$dir" ]; then
        return
    fi
    local url attempt
    for url in "$@"; do
        for attempt in 1 2 3; do
            if git clone --filter=blob:none "$url" "$dir"; then
                git -C "$dir" checkout "$commit"
                return
            fi
            rm -rf "$dir"
            sleep $((attempt * 5))
        done
    done
    echo "Failed to clone $dir from: $*" >&2
    return 1
}

clone_at_commit x264 "$X264_COMMIT" "$X264_URL" "$X264_MIRROR_URL"
clone_at_commit ffmpeg "$FFMPEG_COMMIT" "$FFMPEG_URL" "$FFMPEG_MIRROR_URL"

if [ "$TARGET_OS" == "linux" ]; then
    clone_at_commit nv-codec-headers "$NV_CODEC_COMMIT" "$NV_CODEC_URL"
    clone_at_commit libva "$LIBVA_COMMIT" "$LIBVA_URL"
fi
if [ "$TARGET_OS" == "windows" ]; then
    clone_at_commit nv-codec-headers "$NV_CODEC_COMMIT" "$NV_CODEC_URL"
fi

if [ "$TARGET_OS" == "windows" ] && [ "$HOST_OS" == "windows" ]; then
    cd ffmpeg
    git apply ../command_limit.patch
    git apply ../awk.patch
fi




