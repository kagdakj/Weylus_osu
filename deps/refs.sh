#!/usr/bin/env bash

# Dependency URLs and the branch/tag/ref to pin.
# After editing, run ./update_hashes.sh to regenerate hashes.sh.

X264_URL="https://code.videolan.org/videolan/x264.git"
X264_REF="refs/heads/stable"

FFMPEG_URL="https://code.ffmpeg.org/FFmpeg/FFmpeg.git"
FFMPEG_REF="refs/tags/n8.0"

# GitHub mirrors, used by download.sh if the hosts above can not be reached. Commits are pinned in
# hashes.sh, so the sources are the same.
X264_MIRROR_URL="https://github.com/mirror/x264.git"
FFMPEG_MIRROR_URL="https://github.com/FFmpeg/FFmpeg.git"

NV_CODEC_URL="https://github.com/FFmpeg/nv-codec-headers.git"
NV_CODEC_REF="HEAD"

LIBVA_URL="https://github.com/intel/libva"
LIBVA_REF="refs/tags/2.23.0"
