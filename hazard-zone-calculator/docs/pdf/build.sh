#!/usr/bin/env bash
# Build PDFs from Markdown source.
# Run from the hazard-zone-calculator/ project root:
#   bash docs/pdf/build.sh

set -euo pipefail

# ── Tool paths ────────────────────────────────────────────────────────────────
PANDOC="$LOCALAPPDATA/Pandoc/pandoc.exe"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"

# ── Validate tools are present ────────────────────────────────────────────────
if [ ! -f "$PANDOC" ]; then
  echo "ERROR: pandoc not found at $PANDOC"
  echo "  Install from https://pandoc.org/installing.html"
  exit 1
fi

if [ ! -f "$EDGE" ]; then
  echo "ERROR: Microsoft Edge not found at $EDGE"
  echo "  Edge is required for PDF generation on Windows."
  exit 1
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT="$(pwd)"
OUTDIR="docs/pdf"
CSS="$ROOT/docs/pdf/style.css"
mkdir -p "$OUTDIR"

# URL-encode spaces for file:// URLs
encode_url() {
  echo "file:///$1" | sed 's/ /%20/g' | sed 's|\\|/|g'
}

ROOT_URL=$(encode_url "$ROOT")

# ── Step 1: Markdown → HTML (Pandoc) ──────────────────────────────────────────
echo "Converting Markdown to HTML..."

"$PANDOC" docs/manual.md \
  --standalone \
  --embed-resources \
  --css "$CSS" \
  --metadata title="FAA Hobby Rocket Hazard Zone Calculator — Methodology" \
  --metadata author="Advanced Propulsion Association" \
  --metadata date="$(date +%Y-%m-%d)" \
  --toc \
  --toc-depth=3 \
  -o "$OUTDIR/methodology.html"

"$PANDOC" docs/pdf/waiver-template.md \
  --standalone \
  --embed-resources \
  --css "$CSS" \
  --metadata title="FAA §101.25 Hazard Zone Analysis — Waiver Application" \
  -o "$OUTDIR/waiver-template.html"

echo "  ✓ HTML generated"

# ── Step 2: HTML → PDF (Edge headless) ────────────────────────────────────────
echo "Printing to PDF via Edge..."

"$EDGE" --headless=new --disable-gpu \
  --print-to-pdf="$ROOT/docs/pdf/methodology.pdf" \
  --print-to-pdf-no-header \
  "$ROOT_URL/docs/pdf/methodology.html" 2>/dev/null

echo "  → $OUTDIR/methodology.pdf"

"$EDGE" --headless=new --disable-gpu \
  --print-to-pdf="$ROOT/docs/pdf/waiver-template.pdf" \
  --print-to-pdf-no-header \
  "$ROOT_URL/docs/pdf/waiver-template.html" 2>/dev/null

echo "  → $OUTDIR/waiver-template.pdf"

# ── Step 3: Word template (Pandoc, no LaTeX needed) ───────────────────────────
echo "Generating Word template..."

"$PANDOC" docs/pdf/waiver-template.md \
  --metadata title="FAA §101.25 Hazard Zone Analysis — Waiver Application" \
  --metadata author="Advanced Propulsion Association" \
  -o "$OUTDIR/waiver-template.docx"

echo "  → $OUTDIR/waiver-template.docx"

echo ""
echo "Done. Output files:"
ls -lh "$OUTDIR"/*.pdf "$OUTDIR"/*.docx
