# deploy-lib.sh — shared by update.sh and rollback.sh; sourced, never run. Both scripts
# deploy a release tag the way the boot path (stack-up.sh) starts it: the image
# $LABHUB_IMAGE:<tag>, run through docker-compose.image.yml, with LABHUB_VERSION=<tag> in
# .env as the record of what boots. Until v0.36.1 both scripts started an untagged
# `up -d --build` image and never wrote the pin, so each reboot started the stale pin
# instead (production ran v0.23.0 for a month, found 2026-11-21).
# Source this file BEFORE `git checkout <tag>`: a tag older than this file has no copy.
# shellcheck shell=bash

# The image repository. It must match docker-compose.image.yml.
LABHUB_IMAGE=ghcr.io/rola0002-blip/lab-hub

# valid_tag <tag> — true for a release tag that can name an image: v + a semver version.
valid_tag() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]
}

# build_image <tag> — build the checked-out source with the `build:` settings of
# docker-compose.yml (one definition of the build) and name the result $LABHUB_IMAGE:<tag>.
# Compose tags a build with the service's `image:`, which an override on stdin sets here:
# an override FILE would have to exist at every tag that is checked out.
build_image() {
  printf 'services:\n  app:\n    image: %s:%s\n' "$LABHUB_IMAGE" "$1" |
    docker compose -f docker-compose.yml -f - --profile prod build app
}

# start_image <tag> — start the stack on $LABHUB_IMAGE:<tag> through the image overlay, as
# stack-up.sh does at boot. The LABHUB_VERSION given to this command wins over the value in
# .env, which still holds the old pin here; .env changes only after the health gate.
start_image() {
  LABHUB_VERSION="$1" docker compose -f docker-compose.yml -f docker-compose.image.yml \
    --profile prod --profile tunnel up -d
}

# pin_version <tag> — write LABHUB_VERSION=<tag> to .env: the version the next boot starts.
# .env holds the secrets, so the write is atomic and keeps the file mode: a temp file beside
# it (mktemp makes it 0600), the old mode copied onto it, then a rename. The first
# LABHUB_VERSION line takes the new value and later ones are dropped (stack-up.sh reads the
# last one); the key is added at the end when it is absent.
pin_version() {
  local tag="$1" env=.env mode tmp
  [ -f "$env" ] || { echo "pin_version: no $env file here" >&2; return 1; }
  mode="$(stat -f '%Lp' "$env")" || return 1
  tmp="$(mktemp "$env.pin.XXXXXX")" || return 1
  if awk -v line="LABHUB_VERSION=$tag" '
       /^LABHUB_VERSION=/ { if (!done) print line; done = 1; next }
       { print }
       END { if (!done) print line }
     ' "$env" > "$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "$env"; then
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# prune_images <tag>... — remove the local $LABHUB_IMAGE images whose tag is not given.
# Each release is a separate tagged image (about 3 GB unique), and `docker image prune -f`
# removes only untagged images, so without this each deploy adds one to the Colima VM disk
# until it is full (the v0.18 ENOSPC crash loop). Docker refuses to remove an image that a
# container uses. Only $LABHUB_IMAGE images are touched: other apps share this VM.
prune_images() {
  local ref t keep
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$LABHUB_IMAGE" |
    while IFS= read -r ref; do
      keep=0
      for t in "$@"; do
        if [ "$ref" = "$LABHUB_IMAGE:$t" ]; then keep=1; fi
      done
      if [ "$keep" = 0 ] && docker image rm "$ref" >/dev/null 2>&1; then
        echo "Removed the old image $ref"
      fi
    done
}

# warn_old_boot <tag> — after a deploy, warn when the checked-out stack-up.sh (the tag's
# own copy, which the boot LaunchAgent runs) cannot fall back to the local image. Tags
# before v0.36.1 only pull, so the next boot starts NOTHING unless GHCR has the image.
warn_old_boot() {
  grep -q -- '--pull never' scripts/macos/stack-up.sh 2>/dev/null && return 0
  echo "WARNING: the stack-up.sh of $1 has no local-image fallback. The next boot" >&2
  echo "  starts nothing unless GHCR has $LABHUB_IMAGE:$1" >&2
  echo "  (check: docker manifest inspect $LABHUB_IMAGE:$1)." >&2
}
