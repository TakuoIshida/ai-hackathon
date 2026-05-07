#!/usr/bin/env bash
# Bootstrap script: enable APIs + create Terraform state buckets per env.
#
# Prerequisites (run manually before this script):
#   - GCP projects already created (one per env)
#   - billing account linked to each project
#   - your gcloud is authenticated as a project Owner / Editor with serviceusage.admin
#
# Idempotent: safe to re-run. APIs are skipped if already enabled, buckets if they exist.
set -euo pipefail

# ---- env table -------------------------------------------------------------
# Edit these to match the project IDs you created.
# Using Bash 3.2-compatible parallel arrays (macOS default) instead of associative arrays.

ENVS=("dev" "stg" "prod")
PROJECTS=("ai-hackathon-dev" "ai-hackathon-stg" "ai-hackathon-prod")
REGION="asia-northeast1"

# ---- APIs to enable in every project --------------------------------------
APIS=(
  "iam.googleapis.com"
  "iamcredentials.googleapis.com"
  "sts.googleapis.com"
  "cloudresourcemanager.googleapis.com"
  "serviceusage.googleapis.com"
  "storage.googleapis.com"
  "run.googleapis.com"
  "artifactregistry.googleapis.com"
  "cloudbuild.googleapis.com"
  "sqladmin.googleapis.com"
  "secretmanager.googleapis.com"
  "compute.googleapis.com"
  "vpcaccess.googleapis.com"
  "servicenetworking.googleapis.com"
)

# ---------------------------------------------------------------------------

if [[ ${#ENVS[@]} -ne ${#PROJECTS[@]} ]]; then
  echo "ENVS and PROJECTS arrays must be the same length." >&2
  exit 1
fi

for i in "${!ENVS[@]}"; do
  env="${ENVS[$i]}"
  project="${PROJECTS[$i]}"
  echo
  echo "=== ${env} (${project}) ==="

  if ! gcloud projects describe "${project}" >/dev/null 2>&1; then
    echo "Project ${project} does not exist or you lack access. Skipping." >&2
    continue
  fi

  echo "-- enabling ${#APIS[@]} APIs (this may take a minute)..."
  gcloud services enable "${APIS[@]}" --project="${project}" --quiet

  bucket="tfstate-${project}"
  echo "-- ensuring state bucket gs://${bucket}"
  if gcloud storage buckets describe "gs://${bucket}" --project="${project}" >/dev/null 2>&1; then
    echo "   bucket exists, leaving as-is"
  else
    gcloud storage buckets create "gs://${bucket}" \
      --project="${project}" \
      --location="${REGION}" \
      --uniform-bucket-level-access \
      --public-access-prevention
    gcloud storage buckets update "gs://${bucket}" \
      --project="${project}" \
      --versioning
  fi

  echo "-- ${env} done"
done

echo
echo "All envs bootstrapped."
echo "Next: cd infrastructure/bootstrap/terraform && terraform init && terraform apply"
