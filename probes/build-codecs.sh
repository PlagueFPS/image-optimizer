#!/bin/sh
set -eu
prefix=${1:?usage: build-codecs.sh absolute-install-prefix}
case "$prefix" in /*) ;; *) echo 'prefix must be absolute' >&2; exit 2;; esac
pkg-config --atleast-version=1.5.3 dav1d
pkg-config --atleast-version=3.13.1 aom
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
cd "$build"
curl -fLsS https://github.com/webmproject/libwebp/archive/refs/tags/v1.6.0.tar.gz -o webp.tar.gz
curl -fLsS https://github.com/zlib-ng/zlib-ng/archive/refs/tags/2.3.3.tar.gz -o zng.tar.gz
cat > SHA256SUMS <<'SUMS'
93a852c2b3efafee3723efd4636de855b46f9fe1efddd607e1f42f60fc8f2136  webp.tar.gz
f9c65aa9c852eb8255b636fd9f07ce1c406f061ec19a2e7d508b318ca0c907d1  zng.tar.gz
SUMS
sha256sum -c SHA256SUMS
tar xf webp.tar.gz
tar xf zng.tar.gz
cmake -S libwebp-1.6.0 -B webp-build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DBUILD_SHARED_LIBS=ON \
    -DWEBP_BUILD_EXTRAS=OFF -DWEBP_BUILD_ANIM_UTILS=OFF \
    -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF \
    -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
    -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF
cmake --build webp-build -j 4
cmake --install webp-build
cmake -S zlib-ng-2.3.3 -B zng-build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DZLIB_COMPAT=ON -DZLIB_ENABLE_TESTS=OFF
cmake --build zng-build -j 4
cmake --install zng-build
curl -fLsS https://github.com/strukturag/libheif/releases/download/v1.23.5/libheif-1.23.5.tar.gz -o heif.tar.gz
printf '%s\n' 'fd9036064c4432f0550d15072ddf34956a248279ee9aeaff0fba3fa0f77d8f1a  heif.tar.gz' | sha256sum -c -
tar xf heif.tar.gz
cmake -S libheif-1.23.5 -B heif-build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" -DBUILD_SHARED_LIBS=ON \
    -DWITH_EXAMPLES=OFF -DBUILD_TESTING=OFF -DWITH_GDK_PIXBUF=OFF \
    -DWITH_LIBSHARPYUV=OFF -DWITH_DAV1D=ON -DWITH_DAV1D_PLUGIN=OFF \
    -DWITH_AOM_ENCODER=ON -DWITH_AOM_ENCODER_PLUGIN=OFF -DWITH_AOM_DECODER=OFF
cmake --build heif-build -j 2
cmake --install heif-build
licenses="$prefix/share/licenses/image-optimizer-codecs"
mkdir -p "$licenses"
cp libwebp-1.6.0/COPYING "$licenses/libwebp-COPYING"
cp zlib-ng-2.3.3/LICENSE.md "$licenses/zlib-ng-LICENSE.md"
cp libheif-1.23.5/COPYING "$licenses/libheif-COPYING"
