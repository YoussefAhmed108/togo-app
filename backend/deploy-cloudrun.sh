#!/usr/bin/env bash
# Deploy the backend to Google Cloud Run. Usage: ./deploy-cloudrun.sh <gcp-project-id>
# Re-run it to redeploy; env vars are re-read from .env every time.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=${1:?usage: $0 <gcp-project-id>}
REGION=europe-west3 # Frankfurt, next to the TiDB cluster in eu-central-1
SERVICE=togo-backend

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# New projects don't give the default build service account enough rights for --source deploys.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None >/dev/null

# .env -> Cloud Run env-vars YAML. SERVER_ADDR and LOCAL_* are local-only.
# ponytail: plain env vars, not Secret Manager (billed past 6 secrets); move there if more people get project access.
ENVFILE=$(mktemp)
trap 'rm -f "$ENVFILE"' EXIT
grep -E '^[A-Z_0-9]+=' .env | grep -vE '^(SERVER_ADDR|LOCAL_)' | while IFS='=' read -r k v; do
  # Trim surrounding whitespace/CR like godotenv does — R2_ACCOUNT_ID had a leading space.
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  [[ $v == \"*\" || $v == \'*\' ]] && v=${v:1:${#v}-2}
  printf "%s: '%s'\n" "$k" "${v//\'/\'\'}"
done >"$ENVFILE"

# max-instances caps the bill if traffic spikes; min 0 keeps idle cost at zero.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file "$ENVFILE" \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3

gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
