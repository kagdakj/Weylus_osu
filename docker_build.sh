#!/usr/bin/env sh

set -ex

# cross compile windows version
cargo build --target x86_64-pc-windows-gnu --release --no-default-features

# cleanup cross compiled windows artifacts
(cd deps && ./clean.sh)

# build linux version, VAAPI is disabled in build.rs so there is no va-static variant
cargo deb --no-default-features

# check if installing works
dpkg -i target/debian/weylus-osu*.deb

mkdir packages

PKGDIR="$PWD/packages"

# package windows
(
  cd target/x86_64-pc-windows-gnu/release/
  zip weylus_osu-windows.zip weylus_osu.exe
  mv weylus_osu-windows.zip "$PKGDIR/"
)

# package linux
(
  cp target/debian/weylus-osu*.deb "$PKGDIR/"
  cp weylus.desktop target/release/weylus_osu.desktop
  cd target/release/
  zip weylus_osu-linux.zip weylus_osu weylus_osu.desktop
  mv weylus_osu-linux.zip "$PKGDIR/"
)
