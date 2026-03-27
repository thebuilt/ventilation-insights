#!/bin/zsh

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: ./publish.sh https://github.com/<username>/<repo>.git"
  exit 1
fi

REPO_URL="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"

if [[ ! -d ".git" ]]; then
  git init
fi

git checkout -B main
git add .

if git diff --cached --quiet; then
  if ! git rev-parse HEAD >/dev/null 2>&1; then
    git commit --allow-empty -m "Initial commit"
  fi
else
  git commit -m "Deploy ventilation insights site"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

git push -u origin main --force

echo ""
echo "Pushed to $REPO_URL"
echo "Next in GitHub:"
echo "1. Open the repository Settings > Pages."
echo "2. Set Source to GitHub Actions."
echo "3. Wait for the Deploy GitHub Pages workflow to finish."

