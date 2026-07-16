#!/bin/bash
# clean-macos-meta.sh — authoritative macOS metadata cleanup (plan §5.5 / §16)
#
# Scope per plan §5.5 authoritative source/test/e2e/evidence gate:
#   API/, UI/portal/src, UI/portal/tests, UI/portal/e2e,
#   document/projects/core/evidence
#
# Explicitly EXCLUDED:
#   .git/ (AppleDouble under .git/objects is created by git itself)
#   node_modules/ (third-party; not part of source/evidence)
#
# Plan §16 (2026-07-11) extension — also sweep generated areas that may
# accumulate AppleDouble from local macOS tooling before evidence archival:
#   - coverage/ (phpunit + vitest coverage reports)
#   - playwright-report/ (Playwright HTML report)
#   - test-results/ (Playwright artifacts)
# These directories are gitignored by default, so a clean tree shouldn't
# carry any AppleDouble — but the sweep is a safety net for evidence
# archival.
#
# This is the definitive gate. Use this script for evidence regeneration.

set -e
echo "🧹 clean macOS metadata (authoritative source/test/e2e/evidence scope)..."

# Use /usr/bin/find to avoid rtk shimming.
find API UI/portal/src UI/portal/tests UI/portal/e2e document/projects/core/evidence \
  \( -name '._*' -o -name '.DS_Store' -o -name '.!*' -o -name '.！*' \) -delete 2>/dev/null || true

# Plan §16 (2026-07-11) — sweep generated areas if present.
for gen_dir in coverage playwright-report test-results API/tests/coverage UI/portal/coverage; do
  if [ -d "$gen_dir" ]; then
    find "$gen_dir" \
      \( -name '._*' -o -name '.DS_Store' -o -name '.!*' -o -name '.！*' \) -delete 2>/dev/null || true
  fi
done

# Also clean the repo root and top-level evidence folders if they exist
find . -maxdepth 2 \
  \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

echo "✅ authoritative metadata gate clean"
echo
echo "Verification (should be empty):"
/usr/bin/find API UI/portal/src UI/portal/tests UI/portal/e2e document/projects/core/evidence \
  \( -name '._*' -o -name '.DS_Store' -o -name '.!*' -o -name '.！*' \) -print 2>/dev/null | head -20