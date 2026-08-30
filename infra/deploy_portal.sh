#!/usr/bin/env bash
# Build and deploy the CaseRelay portal to Cloud Run.
# Idempotent and repeatable — run after any portal change to ship it.
#
# The portal is the only public surface in the system. The control plane stays
# private and is reached solely through the portal's own route handlers, which
# mint an ID token as the portal service account — so the browser never holds a
# credential and never learns the control plane's address.
#
#   bash infra/deploy_portal.sh
set -euo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/caserelay/portal:latest"
SERVICE="caserelay-portal"
CONTROL_PLANE_SERVICE="caserelay-control-plane"

# The identity the portal runs as. It is the same account deploy_control_plane.sh
# grants run.invoker to, which is what lets the container call a private service.
PORTAL_SA="${CASERELAY_PORTAL_SA:-caserelay-portal@${PROJECT}.iam.gserviceaccount.com}"

# The Cloud Run service itself is reachable by anyone, because the thing that
# decides who gets in is the password gate in portal/src/middleware.ts rather
# than IAM. That is what lets someone open the portal in a browser with nothing
# installed. Set CASERELAY_PORTAL_PUBLIC=0 to put IAM in front of it as well.
PORTAL_PUBLIC="${CASERELAY_PORTAL_PUBLIC:-1}"

# The shared credential the gate checks. The password lives in Secret Manager
# and is mounted into the service at run time, so it is never an argument to a
# command, never in the image, and never in this file.
PORTAL_USER="${CASERELAY_PORTAL_USER:-admin@caserelay.com}"
PASSWORD_SECRET="${CASERELAY_PORTAL_SECRET:-caserelay-portal-password}"

# Whether the chat panel is wired to the agent. This is compiled into the
# browser bundle during the build, so it is a build argument rather than a
# service environment variable — see the note in portal/Dockerfile.
COPILOT_ENABLED="${CASERELAY_COPILOT_ENABLED:-true}"

# Where the image is built. The other deploy scripts in here build locally with
# docker buildx, so that stays the default; `cloud` hands the build to Cloud
# Build instead, which wants nothing locally but gcloud and is natively amd64
# rather than a Next.js build run under QEMU on an Apple silicon laptop.
BUILD_WHERE="${CASERELAY_BUILD:-local}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Which control plane this portal talks to. Written by deploy_control_plane.sh
# on its last successful deploy, so the two cannot drift apart by hand.
CP_URL_FILE="${REPO_ROOT}/infra/control_plane_url.txt"
if [ -n "${CASERELAY_CONTROL_PLANE_URL:-}" ]; then
  CONTROL_PLANE_URL="$CASERELAY_CONTROL_PLANE_URL"
elif [ -f "$CP_URL_FILE" ]; then
  CONTROL_PLANE_URL="$(tr -d '[:space:]' < "$CP_URL_FILE")"
else
  echo "ERROR: $CP_URL_FILE not found — run infra/deploy_control_plane.sh first" >&2
  exit 1
fi

if [ -z "$CONTROL_PLANE_URL" ]; then
  echo "ERROR: control plane URL is empty — the portal cannot reach anything" >&2
  exit 1
fi
echo "=== control plane: $CONTROL_PLANE_URL ==="

# The service account has to exist before the deploy names it, and creating it
# here means deploying the portal on a fresh project is one command rather than
# a command and a footnote.
if ! gcloud iam service-accounts describe "$PORTAL_SA" --project="$PROJECT" >/dev/null 2>&1; then
  echo "=== creating portal service account ==="
  gcloud iam service-accounts create "${PORTAL_SA%%@*}" \
    --project="$PROJECT" \
    --display-name="CaseRelay Portal BFF"
fi

# The password outlives any one deploy: shipping a new revision should not
# invalidate the credential people were given, so an existing secret is reused
# and only a missing one is created.
gcloud services enable secretmanager.googleapis.com --project="$PROJECT" --quiet >/dev/null 2>&1 || true

PASSWORD_IS_NEW=0
if [ -n "${CASERELAY_PORTAL_PASSWORD:-}" ]; then
  echo "=== storing the supplied portal password ==="
  if gcloud secrets describe "$PASSWORD_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$CASERELAY_PORTAL_PASSWORD" \
      | gcloud secrets versions add "$PASSWORD_SECRET" --project="$PROJECT" --data-file=- >/dev/null
  else
    printf '%s' "$CASERELAY_PORTAL_PASSWORD" \
      | gcloud secrets create "$PASSWORD_SECRET" --project="$PROJECT" \
        --replication-policy=automatic --data-file=- >/dev/null
  fi
elif ! gcloud secrets describe "$PASSWORD_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "=== generating a portal password ==="
  # Letters and digits only. The credential gets typed into a browser dialog and
  # read off a screen, so anything that invites a quoting or transcription
  # mistake costs more than the entropy it adds.
  GENERATED="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true)"
  if [ ${#GENERATED} -ne 24 ]; then
    echo "ERROR: could not generate a password" >&2
    exit 1
  fi
  printf '%s' "$GENERATED" \
    | gcloud secrets create "$PASSWORD_SECRET" --project="$PROJECT" \
      --replication-policy=automatic --data-file=- >/dev/null
  PASSWORD_IS_NEW=1
  unset GENERATED
fi

echo "=== granting the portal SA access to the password ==="
gcloud secrets add-iam-policy-binding "$PASSWORD_SECRET" \
  --project="$PROJECT" \
  --member="serviceAccount:${PORTAL_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

if [ "$BUILD_WHERE" = "cloud" ]; then
  # Cloud Build runs as the Compute Engine default service account, and on a
  # project that has not built this way before it holds none of the three things
  # a build needs: reading the uploaded source, writing the image, and writing
  # its own logs. Granting them here means a first build fails on something
  # about the portal rather than on a 403 about a bucket.
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || echo 189353698936)"
  BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

  echo "=== granting the Cloud Build service account what it needs ==="
  gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="roles/storage.objectViewer" \
    --project="$PROJECT" --quiet >/dev/null 2>&1 || true
  for _role in roles/artifactregistry.writer roles/logging.logWriter; do
    gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:${BUILD_SA}" \
      --role="$_role" \
      --condition=None --quiet >/dev/null 2>&1 || true
  done

  echo "=== building image in Cloud Build ==="
  gcloud builds submit "${REPO_ROOT}/portal" \
    --project="$PROJECT" \
    --config="${REPO_ROOT}/infra/cloudbuild_portal.yaml" \
    --substitutions="_IMAGE=${IMAGE},_COPILOT_ENABLED=${COPILOT_ENABLED}"
else
  echo "=== building linux/amd64 image locally ==="
  docker buildx build --platform linux/amd64 \
    -f portal/Dockerfile \
    --build-arg "NEXT_PUBLIC_COPILOT_ENABLED=${COPILOT_ENABLED}" \
    -t "$IMAGE" \
    --push "${REPO_ROOT}/portal"
fi

if [ "$PORTAL_PUBLIC" = "1" ]; then
  ACCESS_FLAG="--allow-unauthenticated"
else
  ACCESS_FLAG="--no-allow-unauthenticated"
fi

echo "=== deploying $SERVICE ($ACCESS_FLAG) ==="
# --no-cpu-throttling and the long timeout are both for the same reason: the
# chat replies stream, and a throttled instance stops relaying tokens between
# chunks while a short timeout cuts the answer off mid-sentence.
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  "$ACCESS_FLAG" \
  --service-account="$PORTAL_SA" \
  --set-env-vars="CONTROL_PLANE_URL=${CONTROL_PLANE_URL},PORTAL_AUTH_USER=${PORTAL_USER}" \
  --set-secrets="PORTAL_AUTH_PASSWORD=${PASSWORD_SECRET}:latest" \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=4 \
  --timeout=900 \
  --no-cpu-throttling \
  --execution-environment=gen2

# Granted here as well as in deploy_control_plane.sh, so that shipping the
# portal on its own is enough to leave it able to reach the control plane.
echo "=== granting run.invoker on the control plane to the portal SA ==="
gcloud run services add-iam-policy-binding "$CONTROL_PLANE_SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --member="serviceAccount:${PORTAL_SA}" \
  --role="roles/run.invoker" \
  --quiet

SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)')

# Two things are worth proving after a deploy, and neither is "the revision
# started". The first is that the gate actually refuses an anonymous request —
# a middleware matcher that quietly stops matching would leave case data on a
# public URL and nothing else would notice. The second is that an authenticated
# request reaches the control plane, which is the failure a home page cannot
# show because it renders without touching anything upstream.
if [ "$PORTAL_PUBLIC" = "1" ]; then
  echo "=== checking the password gate refuses anonymous requests ==="
  ANON_HTTP="000"
  for _i in 1 2 3; do
    ANON_HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 \
      "${SERVICE_URL}/api/control-plane/v1/cases" 2>/dev/null) || ANON_HTTP="000"
    [ "$ANON_HTTP" != "000" ] && break
    [ "$_i" -lt 3 ] && sleep 10
  done

  if [ "$ANON_HTTP" = "401" ]; then
    echo "    PASS: case data is refused without the password"
  elif [ "$ANON_HTTP" = "503" ]; then
    echo "FAIL: the gate is on but has no password — the secret did not mount" >&2
    echo "  check that ${PORTAL_SA} can read ${PASSWORD_SECRET}" >&2
    exit 1
  else
    echo "FAIL: anonymous request returned HTTP $ANON_HTTP, expected 401" >&2
    echo "  the portal may be serving case data to anyone with the URL" >&2
    exit 1
  fi

  # Read back rather than kept from above, so this also proves the version the
  # service is actually mounting is the version being tested against.
  PORTAL_PASSWORD="$(gcloud secrets versions access latest \
    --secret="$PASSWORD_SECRET" --project="$PROJECT" 2>/dev/null || true)"

  if [ -n "$PORTAL_PASSWORD" ]; then
    echo "=== checking the portal can reach the control plane ==="
    # Passed in a file curl reads rather than on the command line, which every
    # other process on the machine can see.
    PROBE_RC="$(mktemp)"
    chmod 600 "$PROBE_RC"
    trap 'rm -f "$PROBE_RC"' EXIT
    printf 'user = "%s:%s"\n' "$PORTAL_USER" "$PORTAL_PASSWORD" > "$PROBE_RC"

    PROBE_HTTP="000"
    for _i in 1 2 3; do
      PROBE_HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 \
        -K "$PROBE_RC" "${SERVICE_URL}/api/control-plane/v1/cases" 2>/dev/null) || PROBE_HTTP="000"
      [ "$PROBE_HTTP" = "200" ] && break
      echo "  attempt ${_i}/3: HTTP $PROBE_HTTP"
      [ "$_i" -lt 3 ] && sleep 10
    done

    rm -f "$PROBE_RC"
    trap - EXIT

    if [ "$PROBE_HTTP" != "200" ]; then
      echo "WARN: signed in, but /api/control-plane/v1/cases returned HTTP $PROBE_HTTP" >&2
      echo "  the UI will load; case data will not. Check in this order:" >&2
      echo "    1. gcloud run services logs read $SERVICE --project=$PROJECT --region=$REGION" >&2
      echo "    2. that ${PORTAL_SA} holds run.invoker on ${CONTROL_PLANE_SERVICE}" >&2
      echo "    3. that CONTROL_PLANE_URL is $CONTROL_PLANE_URL" >&2
    else
      echo "    PASS: case data is reaching the portal"
    fi
  fi
fi

echo "$SERVICE_URL" > "${REPO_ROOT}/infra/portal_url.txt"
echo ""
echo "=== deployed: $SERVICE_URL ==="
echo "    username: $PORTAL_USER"
if [ "$PASSWORD_IS_NEW" = "1" ]; then
  # Printed once, on the run that created it. After this the secret is the only
  # copy, which is the point of keeping it there.
  echo "    password: $(gcloud secrets versions access latest \
    --secret="$PASSWORD_SECRET" --project="$PROJECT")"
  echo ""
  echo "    Written down now or read back later with:"
  echo "      gcloud secrets versions access latest --secret=$PASSWORD_SECRET --project=$PROJECT"
else
  echo "    password: unchanged — read it with"
  echo "      gcloud secrets versions access latest --secret=$PASSWORD_SECRET --project=$PROJECT"
  echo "    change it with"
  echo "      CASERELAY_PORTAL_PASSWORD=... bash infra/deploy_portal.sh"
fi
