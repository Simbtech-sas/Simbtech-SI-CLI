#!/usr/bin/env bash
#
# Does every image a tool brings in actually exist?
#
# This is not paranoia. Eight of twenty-eight were wrong when it was first run:
# a tag that was never published, a version that does not exist yet, and one
# whose Docker Hub org was simply not the project's. Every one of them fails at
# `docker compose up` — for whoever ADDED the tool, not whoever wrote it.
#
# Uses each registry's metadata API rather than `docker manifest inspect`,
# because 28 rapid anonymous pull-manifest calls exhaust Docker Hub's quota and
# every image then looks missing. That false negative is worse than no check:
# the first run of this reported nine failures, six real and three invented.
#
# Usage: scripts/verify-images.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

images=$(python3 - <<'PY'
import yaml, glob, pathlib
seen = {}
# The BASE dev stack too. It shipped three `:latest` tags — the exact thing the
# tool entries are held to — and nothing was looking at it.
for f in sorted(glob.glob('templates/*/infra/docker-compose.yml')):
    flavor = pathlib.Path(f).parts[1]
    doc = yaml.safe_load(pathlib.Path(f).read_text().replace('{{brand}}', 'acme')) or {}
    for svc, d in (doc.get('services') or {}).items():
        if d.get('image'):
            seen[f"{flavor}-base/{svc}"] = d['image']
for f in sorted(glob.glob('packages/tools/templates/*/compose.yml')):
    tid = pathlib.Path(f).parent.name
    doc = yaml.safe_load(pathlib.Path(f).read_text().replace('{{brand}}', 'acme')) or {}
    for svc, d in (doc.get('services') or {}).items():
        if d.get('image'):
            seen[f"{tid}/{svc}"] = d['image']
for k, v in seen.items():
    print(k, v)
PY
)

fail=0
checked=0
while read -r who image; do
  [ -z "$image" ] && continue
  checked=$((checked + 1))
  repo="${image%:*}"
  tag="${image##*:}"

  if [ "$tag" = latest ] || [ "$tag" = "$repo" ]; then
    printf '  FAIL %-26s %s  (unpinned)\n' "$who" "$image"
    fail=$((fail + 1)); continue
  fi

  case "$repo" in
    ghcr.io/*)
      path="${repo#ghcr.io/}"
      token=$(curl -sf "https://ghcr.io/token?scope=repository:${path}:pull" \
              | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null)
      code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
             -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
             "https://ghcr.io/v2/${path}/manifests/${tag}")
      ;;
    quay.io/*)
      path="${repo#quay.io/}"
      code=$(curl -s -o /dev/null -w '%{http_code}' \
             "https://quay.io/api/v1/repository/${path}/tag/?specificTag=${tag}&onlyActiveTags=true")
      # quay answers 200 with an empty list for a tag that does not exist.
      if [ "$code" = 200 ]; then
        found=$(curl -s "https://quay.io/api/v1/repository/${path}/tag/?specificTag=${tag}&onlyActiveTags=true" \
                | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("tags",[])))' 2>/dev/null)
        [ "${found:-0}" -gt 0 ] || code=404
      fi
      ;;
    *)
      # Docker Hub. Official images live under library/.
      if [ "$tag" = latest ] || [ "$tag" = "$repo" ]; then
    printf '  FAIL %-26s %s  (unpinned)\n' "$who" "$image"
    fail=$((fail + 1)); continue
  fi

  case "$repo" in */*) path="$repo" ;; *) path="library/$repo" ;; esac
      code=$(curl -s -o /dev/null -w '%{http_code}' "https://hub.docker.com/v2/repositories/${path}/tags/${tag}")
      ;;
  esac

  if [ "$code" = 200 ]; then
    printf '  ok   %-26s %s\n' "$who" "$image"
  else
    printf '  FAIL %-26s %s  (HTTP %s)\n' "$who" "$image" "$code"
    fail=$((fail + 1))
  fi
  # Paced deliberately. Hammering these APIs is what produced the false
  # negatives that made the first version of this script untrustworthy.
  sleep 1
done <<< "$images"

echo
[ "$fail" -eq 0 ] || { echo "$fail of $checked images could not be resolved"; exit 1; }
echo "all $checked tool images resolve"
