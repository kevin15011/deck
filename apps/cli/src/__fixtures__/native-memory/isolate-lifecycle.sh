#!/bin/sh
# Invoked only by the acceptance launcher inside fresh user/mount/network/PID
# namespaces. No host HOME, account files or external network enter the root.
set -eu
repo=$1 evidence=$2 runner=$3 bun_bin=$4 node_bin=$5 native_bin=$6
mount -t tmpfs tmpfs /tmp
mkdir -m700 /tmp/root
mkdir -p /tmp/root/usr /tmp/root/proc /tmp/root/dev /tmp/root/workspace /tmp/root/evidence /tmp/root/tools /tmp/root/tmp/lifecycle-home /tmp/root/etc
printf 'root:x:0:0:Fixture:/tmp/lifecycle-home:/bin/bash\n' > /tmp/root/etc/passwd
printf 'root:x:0:\n' > /tmp/root/etc/group
printf '127.0.0.1 localhost\n::1 localhost\n' > /tmp/root/etc/hosts
chmod 1777 /tmp/root/tmp
chmod 700 /tmp/root/tmp/lifecycle-home
ln -s usr/bin /tmp/root/bin
ln -s usr/lib /tmp/root/lib
ln -s usr/lib64 /tmp/root/lib64
mount --rbind /usr /tmp/root/usr
mount -t proc proc /tmp/root/proc
mount --rbind /dev /tmp/root/dev
mount --bind "$repo" /tmp/root/workspace
mount -o remount,bind,ro /tmp/root/workspace
mount --bind "$evidence" /tmp/root/evidence
for name in bun node native; do
  case "$name" in bun) source=$bun_bin;; node) source=$node_bin;; native) source=$native_bin;; esac
  touch "/tmp/root/tools/$name"
  mount --bind "$source" "/tmp/root/tools/$name"
done
ip link set lo up
exec /usr/sbin/chroot /tmp/root /usr/bin/env -i \
  TAR_OPTIONS=--no-same-owner GIT_CONFIG_NOSYSTEM=1 HOME=/tmp/lifecycle-home TMPDIR=/tmp \
  PATH=/tools:/usr/bin:/bin NODE_EXECUTABLE=/tools/node \
  NATIVE_CODEX=/tools/native NATIVE_OPENCODE=/tools/native NATIVE_CLAUDE=/tools/native \
  /tools/bun "${7:-/workspace/apps/cli/src/__fixtures__/native-memory/lifecycle.ts}" /evidence "$runner" "${8:-}"
