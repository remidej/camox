#!/bin/bash
set -eu

cd "$(dirname "$0")/.."

# Git lists the main checkout first, including when called from a worktree.
IFS= read -r -d '' main_worktree < <(git worktree list --porcelain -z)
source_root=${main_worktree#worktree }

# This script is also available in T3's scripts menu in the main checkout.
if [ "$source_root" = "$(pwd -P)" ]; then
  exit 0
fi

while IFS= read -r file || [ -n "$file" ]; do
  case "$file" in
    ''|\#*) continue ;;
  esac

  if [ ! -f "$source_root/$file" ]; then
    printf 'Skipping missing local file: %s\n' "$file" >&2
    continue
  fi

  mkdir -p "$(dirname "$file")"
  cp "$source_root/$file" "$file"
done < .agents/linked
