#!/usr/bin/env bash
# Build PDFs from Markdown source using Pandoc + XeLaTeX.
# Run from the hazard-zone-calculator/ project root.
#
# Requirements:
#   - Pandoc: https://pandoc.org/installing.html
#   - XeLaTeX: MiKTeX (Windows), MacTeX (macOS), texlive-xetex (Linux)
#   - On Windows: run from Git Bash or WSL
#
# Usage:
#   bash docs/pdf/build.sh

set -euo pipefail

OUTDIR="docs/pdf"
mkdir -p "$OUTDIR"

echo "Building methodology PDF..."
pandoc docs/manual.md \
  --pdf-engine=xelatex \
  --metadata title="FAA Hobby Rocket Hazard Zone Calculator — Methodology" \
  --metadata author="Advanced Propulsion Association" \
  --metadata date="$(date +%Y-%m-%d)" \
  --toc \
  --toc-depth=3 \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -o "$OUTDIR/methodology.pdf"
echo "  → $OUTDIR/methodology.pdf"

echo "Building per-waiver template PDF..."
pandoc docs/pdf/waiver-template.md \
  --pdf-engine=xelatex \
  --metadata author="Advanced Propulsion Association" \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -o "$OUTDIR/waiver-template.pdf"
echo "  → $OUTDIR/waiver-template.pdf"

echo "Done."
