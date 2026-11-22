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
node scripts/update-recommendation.mjs "$packet"

if ! git diff --quiet -- public/recommendations.js; then
  git add public/recommendations.js
  git -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -m "Add approved catalog recommendation"
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin HEAD:main
fi
site_sha="$(git rev-parse HEAD)"
release_tag="recommendation-$RECOMMENDATION_ID-${site_sha:0:12}"
if release_state="$(gh release view "$release_tag" --json isDraft,isPrerelease 2>/dev/null)"; then
  if [[ "$(jq -r '.isDraft' <<< "$release_state")" == true ]]; then exit 1; fi
  if [[ "$(jq -r '.isPrerelease' <<< "$release_state")" == false ]]; then
    echo 'skip=true' >> "$GITHUB_OUTPUT"
    exit 0
  fi
else
  gh release create "$release_tag" --target "$site_sha" --prerelease \
    --title "火市・技术科 · 资源收录" --notes "添加一条站长批准的资源推荐。"
fi
printf 'RELEASE_TAG=%s\nSITE_SHA=%s\n' "$release_tag" "$site_sha" >> "$GITHUB_ENV"
