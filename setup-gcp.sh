#!/usr/bin/env bash
# One-time GCP bootstrap for ifc-lite (server on Cloud Run + static webapp on GCS)
# Usage: PROJECT_ID=ifcprojectmanager GH_ORG=my-org GH_SERVER_REPO=ifc-lite-server GH_WEB_REPO=ifc-lite-webapp ./setup-gcp.sh
set -euo pipefail

: "${PROJECT_ID:?}" "${GH_ORG:?}" "${GH_SERVER_REPO:?}" "${GH_WEB_REPO:?}"
REGION="${REGION:-europe-west9}"          # Paris
AR_REPO="${AR_REPO:-ifc}"
DATA_BUCKET="${DATA_BUCKET:-${PROJECT_ID}-ifc-data}"   # models + server cache
WEB_BUCKET="${WEB_BUCKET:-${PROJECT_ID}-ifc-web}"      # static webapp

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com compute.googleapis.com secretmanager.googleapis.com

# Registry + buckets
gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
  --location="$REGION" 2>/dev/null || true
gcloud storage buckets create "gs://$DATA_BUCKET" --location="$REGION" \
  --uniform-bucket-level-access 2>/dev/null || true
gcloud storage buckets create "gs://$WEB_BUCKET" --location="$REGION" \
  --uniform-bucket-level-access 2>/dev/null || true

# Runtime service account for Cloud Run (access to the data bucket only)
gcloud iam service-accounts create ifc-server-runtime 2>/dev/null || true
RUNTIME_SA="ifc-server-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$DATA_BUCKET" \
  --member="serviceAccount:$RUNTIME_SA" --role="roles/storage.objectAdmin"

# Deployer service accounts used by GitHub Actions
gcloud iam service-accounts create gh-deploy-server 2>/dev/null || true
gcloud iam service-accounts create gh-deploy-web 2>/dev/null || true
SERVER_SA="gh-deploy-server@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_SA="gh-deploy-web@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVER_SA" --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVER_SA" --role="roles/artifactregistry.writer"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$SERVER_SA" --role="roles/iam.serviceAccountUser"
gcloud storage buckets add-iam-policy-binding "gs://$WEB_BUCKET" \
  --member="serviceAccount:$WEB_SA" --role="roles/storage.objectAdmin"

# Workload Identity Federation (no JSON keys in GitHub)
gcloud iam workload-identity-pools create github --location=global \
  --display-name="GitHub Actions" 2>/dev/null || true
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository_owner=='${GH_ORG}'" 2>/dev/null || true

POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github"
gcloud iam service-accounts add-iam-policy-binding "$SERVER_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${GH_ORG}/${GH_SERVER_REPO}"
gcloud iam service-accounts add-iam-policy-binding "$WEB_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${GH_ORG}/${GH_WEB_REPO}"

cat <<EOF

=== GitHub repository variables to set ===
GCP_PROJECT_ID                 = $PROJECT_ID
GCP_REGION                     = $REGION
WIF_PROVIDER                   = ${POOL}/providers/github-provider
(server repo) GCP_SERVICE_ACCOUNT = $SERVER_SA
(server repo) RUNTIME_SA          = $RUNTIME_SA
(server repo) DATA_BUCKET         = $DATA_BUCKET
(web repo)    GCP_SERVICE_ACCOUNT = $WEB_SA
(web repo)    WEB_BUCKET          = $WEB_BUCKET
EOF