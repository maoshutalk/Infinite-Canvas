#!/bin/bash
echo "🧹 clean macOS meta..."
find . -name '._*' -delete 2>/dev/null
find . -name '.!*' -delete 2>/dev/null
echo "✅ clean done"
