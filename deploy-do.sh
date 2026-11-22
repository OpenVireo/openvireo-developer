#!/usr/bin/env bash
# Deploys the developer site to DigitalOcean App Platform from .do/app.yaml and has App Platform manage the
# developer.openvireo.com record in the openvireo.com DigitalOcean DNS zone. Safe to rerun: it creates the app
# the first time and updates it after that.
set -euo pipefail

ZONE=openvireo.com
cd "$(dirname "$0")"

doctl account get --format Email --no-header >/dev/null || { echo "doctl is not signed in (doctl auth init)" >&2; exit 1; }
doctl compute domain get "$ZONE" >/dev/null 2>&1 || { echo "$ZONE is not in DigitalOcean DNS; deploy openvireo-site first" >&2; exit 1; }

existing=$(doctl compute domain records list "$ZONE" --format Type,Name,Data --no-header \
  | awk '($1 == "A" || $1 == "AAAA" || $1 == "CNAME") && $2 == "developer"')
if [[ -n "$existing" ]]; then
  echo "Warning: $ZONE already has these records for developer, which may conflict with the app's:"
  echo "$existing"
fi

# Same spec, with the domain marked as managed in the zone so App Platform adds its record
spec=$(mktemp -t openvireo-developer-app.XXXXXX)
trap 'rm -f "$spec"' EXIT
sed -E "s/^(- domain: .*)$/\1\n  zone: $ZONE/" .do/app.yaml > "$spec"
doctl apps spec validate "$spec" >/dev/null

name=$(awk '/^name:/ { print $2; exit }' .do/app.yaml)
app_id=$(doctl apps list --format ID,Spec.Name --no-header | awk -v n="$name" '$2 == n { print $1; exit }')

if [[ -z "$app_id" ]]; then
  echo "Creating app $name (waits for the first deployment)"
  app_id=$(doctl apps create --spec "$spec" --wait --format ID --no-header)
else
  echo "Updating app $name ($app_id)"
  doctl apps update "$app_id" --spec "$spec" --wait --format ID --no-header >/dev/null
fi

echo
doctl apps get "$app_id" --format ID,DefaultIngress,ActiveDeployment.ID,Updated
