#!/usr/bin/env bash
set -euo pipefail

[[ "$RECOMMENDATION_ID" =~ ^[0-9a-f-]{36}$ && -n "$RECOMMENDATION_TOKEN" ]]
git fetch origin main
git checkout --detach origin/main

packet="$(mktemp)"
trap 'rm -f "$packet"' EXIT
curl --silent --show-error --fail --max-time 25 \
  -H "Authorization: Bearer $RECOMMENDATION_TOKEN" \
  "$RECOMMENDATION_API/internal/publication/$RECOMMENDATION_ID" > "$packet"
if [[ "$(jq -r '.state' "$packet")" != publish ]]; then
  echo 'skip=true' >> "$GITHUB_OUTPUT"
  exit 0
fi
release_tag="$(node scripts/update-recommendation.mjs "$packet")"

if ! git diff --quiet -- public/recommendations.js public/releases.json; then
  base_version="$(git show HEAD:public/releases.json | jq -er '.[0].version')"
  live_version="$(curl -fsSL --max-time 25 -H 'Cache-Control: no-cache' "${PUBLIC_URL%/}/releases.json" | jq -er '.[0].version')"
  if [[ "$base_version" != "$live_version" ]]; then
    echo 'The current site version must be published before adding another release.' >&2
    exit 1
  fi
  git add public/recommendations.js public/releases.json
  git -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -m "$release_tag: add approved catalog recommendation"
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin HEAD:main
elif [[ "$release_tag" != "$(jq -er '.[0].version' public/releases.json)" ]]; then
  # Let the Worker verify the entry on the live site without redeploying an older version.
  echo 'skip=true' >> "$GITHUB_OUTPUT"
  exit 0
fi
site_sha="$(git rev-parse HEAD)"
if release_state="$(gh release view "$release_tag" --json isDraft,isPrerelease 2>/dev/null)"; then
  if [[ "$(jq -r '.isDraft' <<< "$release_state")" == true ]]; then exit 1; fi
  if [[ "$(jq -r '.isPrerelease' <<< "$release_state")" == false ]]; then
    echo 'skip=true' >> "$GITHUB_OUTPUT"
    exit 0
  fi
else
  notes="$(jq -r '.[0].resources[0] | "「\(.section)」新增 \(.title)。"' public/releases.json)"
  gh release create "$release_tag" --target "$site_sha" --prerelease \
    --title "火市・技术科 $release_tag · 资源收录" --notes "$notes"
fi
printf 'RELEASE_TAG=%s\nSITE_SHA=%s\n' "$release_tag" "$site_sha" >> "$GITHUB_ENV"
