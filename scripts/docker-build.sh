#!/usr/bin/env bash

set -e

# Build and push the API Spector CLI Docker image to Docker Hub.
# Single-image counterpart of the practice-software-testing build script.

# Configuration
DOCKER_USER="testsmith"
IMAGE_NAME="api-spector"
DOCKERFILE="./Dockerfile"
CONTEXT_DIR="."
TARGET="production"

# Flags
SKIP_PUSH=false
DRY_RUN=false
TAG=""
HELP=false

print_help() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Builds ${DOCKER_USER}/${IMAGE_NAME} from ${DOCKERFILE}."
  echo ""
  echo "Options:"
  echo "  -h, --help          Show this help message"
  echo "  --tag <version>     Docker tag to apply (e.g., v1.2.0); also pushes latest"
  echo "  --skip-push         Build the image but don't push to Docker Hub"
  echo "  --dry-run           Show what would be built without actually building"
  echo ""
  echo "Examples:"
  echo "  $0                  # Build and push ${DOCKER_USER}/${IMAGE_NAME}:latest"
  echo "  $0 --tag v1.2.0     # Build and push :v1.2.0 and :latest"
  echo "  $0 --skip-push      # Build only, no push"
  exit 0
}

build_image() {
  local base_image="$DOCKER_USER/$IMAGE_NAME"
  # With a tag: push that tag and also latest. Without: latest only.
  local version_tag="${base_image}:${TAG:-latest}"
  local latest_tag="${base_image}:latest"

  echo "📦 Building: $version_tag"
  echo "🔍 Context: $CONTEXT_DIR"
  echo "📝 Dockerfile: $DOCKERFILE"

  if [ "$DRY_RUN" = false ]; then
    docker build -t "$version_tag" \
      --target "$TARGET" \
      -f "$DOCKERFILE" "$CONTEXT_DIR"
  else
    echo "💡 Dry run: docker build -t \"$version_tag\" --target $TARGET -f \"$DOCKERFILE\" \"$CONTEXT_DIR\""
  fi

  if [ "$SKIP_PUSH" = false ] && [ "$DRY_RUN" = false ]; then
    echo "📤 Pushing: $version_tag"
    docker push "$version_tag"

    if [ -n "$TAG" ]; then
      echo "🏷  Tagging also as latest: $latest_tag"
      docker tag "$version_tag" "$latest_tag"
      echo "📤 Pushing: $latest_tag"
      docker push "$latest_tag"
    fi
  elif [ "$SKIP_PUSH" = false ]; then
    echo "💡 Dry run: docker push \"$version_tag\""
    [ -n "$TAG" ] && echo "💡 Dry run: docker tag \"$version_tag\" \"$latest_tag\" && docker push \"$latest_tag\""
  fi

  echo ""
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      HELP=true
      ;;
    --tag)
      TAG="$2"
      shift
      ;;
    --skip-push)
      SKIP_PUSH=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      echo "❌ Unknown option: $1"
      exit 1
      ;;
  esac
  shift
done

$HELP && print_help

build_image
