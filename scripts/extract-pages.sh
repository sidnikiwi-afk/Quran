#!/usr/bin/env bash
# extract-pages.sh — Extract mushaf pages from 13-line Quran PDF
#
# The PDF has 424 landscape pages, each containing TWO mushaf pages side-by-side.
# Pages are in REVERSE order (PDF page 1 = end of Quran, page 424 = Al-Fatihah).
#
# Layout per PDF page:
#   RIGHT half = earlier mushaf page (lower number)
#   LEFT half  = later mushaf page (higher number)
#
# Mapping:
#   PDF page P, right half = mushaf page (850 - 2*P)
#   PDF page P, left half  = mushaf page (851 - 2*P)
#
# PDF page 424 right = mushaf page 2 (Al-Fatihah)
# PDF page 424 left  = mushaf page 3 (Al-Baqarah start)
# PDF page 1 right   = mushaf page 848 (An-Nas + dua)
# PDF page 1 left    = ornamental back cover (SKIPPED)
#
# Output: pages numbered 1-847 (output page N = mushaf page N+1)
#   Output page 1   = Al-Fatihah
#   Output page 847 = last page (An-Nas + dua)
#
# Three WebP tiers:
#   thumb/  — quality 30, width 100px  (blur placeholder, ~5KB)
#   medium/ — quality 70, width 1000px (default view, ~100KB)
#   high/   — quality 85, width 1800px (zoom, ~300KB)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PDF="$PROJECT_DIR/assets/source/13LineQuran.pdf"
TMP_DIR="$PROJECT_DIR/assets/source/tmp_extract"
THUMB_DIR="$PROJECT_DIR/app/images/pages/thumb"
MEDIUM_DIR="$PROJECT_DIR/app/images/pages/medium"
HIGH_DIR="$PROJECT_DIR/app/images/pages/high"

TOTAL_PDF_PAGES=424
TOTAL_MUSHAF_PAGES=847  # mushaf pages 2-848, output as 1-847

echo "=== 13-Line Quran Page Extractor ==="
echo "PDF: $PDF"
echo "Output: $PROJECT_DIR/app/images/pages/{thumb,medium,high}/"
echo ""

# Check prerequisites
if ! command -v pdftoppm &>/dev/null; then
    echo "ERROR: pdftoppm not found. Install poppler: brew install poppler"
    exit 1
fi
if ! command -v cwebp &>/dev/null; then
    echo "ERROR: cwebp not found. Install webp: brew install webp"
    exit 1
fi
if ! python3 -c "from PIL import Image" &>/dev/null; then
    echo "ERROR: Pillow not found. Install: pip3 install Pillow"
    exit 1
fi

# Create directories
mkdir -p "$TMP_DIR" "$THUMB_DIR" "$MEDIUM_DIR" "$HIGH_DIR"

# ─── Phase 1: Extract all PDF pages as PNG at 300 DPI ───
echo "Phase 1: Extracting $TOTAL_PDF_PAGES PDF pages as PNG (300 DPI)..."
echo "  This will take several minutes..."

# Check if extraction already done (resume support)
EXISTING_PNGS=$(ls "$TMP_DIR"/page-*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$EXISTING_PNGS" -eq "$TOTAL_PDF_PAGES" ]; then
    echo "  Found $EXISTING_PNGS existing PNGs, skipping extraction."
else
    # Extract all pages at once (faster than one-by-one)
    pdftoppm -png -r 300 "$PDF" "$TMP_DIR/page"

    # Verify extraction count
    EXTRACTED=$(ls "$TMP_DIR"/page-*.png 2>/dev/null | wc -l | tr -d ' ')
    echo "  Extracted $EXTRACTED PNG files."
    if [ "$EXTRACTED" -ne "$TOTAL_PDF_PAGES" ]; then
        echo "WARNING: Expected $TOTAL_PDF_PAGES pages, got $EXTRACTED"
    fi
fi

# ─── Phase 2: Split and convert ───
echo ""
echo "Phase 2: Splitting into halves and converting to 3-tier WebP..."

python3 << 'PYTHON_SCRIPT'
import os
import sys
from PIL import Image
import subprocess

project_dir = os.environ.get("PROJECT_DIR", ".")
tmp_dir = os.path.join(project_dir, "assets/source/tmp_extract")
thumb_dir = os.path.join(project_dir, "app/images/pages/thumb")
medium_dir = os.path.join(project_dir, "app/images/pages/medium")
high_dir = os.path.join(project_dir, "app/images/pages/high")

TOTAL_PDF_PAGES = 424

# Build sorted list of extracted PNGs
png_files = sorted([f for f in os.listdir(tmp_dir) if f.startswith("page-") and f.endswith(".png")])
print(f"  Found {len(png_files)} PNG files to process.")

# Output page counter (1-based)
output_page = 0
processed = 0
skipped = 0

# Process PDF pages from 424 down to 1 (beginning to end of Quran)
for pdf_page in range(TOTAL_PDF_PAGES, 0, -1):
    # pdftoppm names files as page-NNN.png (zero-padded to 3 digits)
    png_name = f"page-{pdf_page:03d}.png"
    png_path = os.path.join(tmp_dir, png_name)

    if not os.path.exists(png_path):
        print(f"  WARNING: Missing {png_name}, skipping.")
        continue

    img = Image.open(png_path)
    w, h = img.size
    mid = w // 2

    # Right half first (earlier mushaf page), then left half
    halves = []

    # Right half = earlier mushaf page
    right = img.crop((mid, 0, w, h))
    halves.append(right)

    # Left half = later mushaf page
    # SKIP: PDF page 1 left half is ornamental back cover
    if pdf_page > 1:
        left = img.crop((0, 0, mid, h))
        halves.append(left)

    for half_img in halves:
        output_page += 1

        # Check if already processed (resume support)
        thumb_path = os.path.join(thumb_dir, f"{output_page}.webp")
        medium_path = os.path.join(medium_dir, f"{output_page}.webp")
        high_path = os.path.join(high_dir, f"{output_page}.webp")

        if os.path.exists(thumb_path) and os.path.exists(medium_path) and os.path.exists(high_path):
            skipped += 1
            continue

        # Save temp PNG for cwebp
        temp_png = os.path.join(tmp_dir, f"half_{output_page}.png")
        half_img.save(temp_png, "PNG")

        hw, hh = half_img.size

        # Thumb: width 100px, quality 30
        subprocess.run([
            "cwebp", "-q", "30", "-resize", "100", "0",
            temp_png, "-o", thumb_path
        ], capture_output=True, check=True)

        # Medium: width 1000px, quality 70
        if hw > 1000:
            subprocess.run([
                "cwebp", "-q", "70", "-resize", "1000", "0",
                temp_png, "-o", medium_path
            ], capture_output=True, check=True)
        else:
            subprocess.run([
                "cwebp", "-q", "70",
                temp_png, "-o", medium_path
            ], capture_output=True, check=True)

        # High: width 1800px, quality 85
        if hw > 1800:
            subprocess.run([
                "cwebp", "-q", "85", "-resize", "1800", "0",
                temp_png, "-o", high_path
            ], capture_output=True, check=True)
        else:
            subprocess.run([
                "cwebp", "-q", "85",
                temp_png, "-o", high_path
            ], capture_output=True, check=True)

        # Clean up temp half PNG
        os.remove(temp_png)

        processed += 1
        if processed % 50 == 0 or output_page <= 3 or output_page >= 845:
            ts = subprocess.run(["stat", "-f%z", thumb_path], capture_output=True, text=True).stdout.strip()
            ms = subprocess.run(["stat", "-f%z", medium_path], capture_output=True, text=True).stdout.strip()
            hs = subprocess.run(["stat", "-f%z", high_path], capture_output=True, text=True).stdout.strip()
            print(f"  Page {output_page:>3}: thumb={ts}B medium={ms}B high={hs}B")

print(f"\n  Done! Processed {processed} pages, skipped {skipped} (already done).")
print(f"  Total output pages: {output_page}")
PYTHON_SCRIPT

# ─── Phase 3: Verify ───
echo ""
echo "Phase 3: Verification"
THUMB_COUNT=$(ls "$THUMB_DIR"/*.webp 2>/dev/null | wc -l | tr -d ' ')
MEDIUM_COUNT=$(ls "$MEDIUM_DIR"/*.webp 2>/dev/null | wc -l | tr -d ' ')
HIGH_COUNT=$(ls "$HIGH_DIR"/*.webp 2>/dev/null | wc -l | tr -d ' ')

echo "  Thumb pages:  $THUMB_COUNT"
echo "  Medium pages: $MEDIUM_COUNT"
echo "  High pages:   $HIGH_COUNT"

if [ "$THUMB_COUNT" -eq "$TOTAL_MUSHAF_PAGES" ] && \
   [ "$MEDIUM_COUNT" -eq "$TOTAL_MUSHAF_PAGES" ] && \
   [ "$HIGH_COUNT" -eq "$TOTAL_MUSHAF_PAGES" ]; then
    echo "  ✓ All $TOTAL_MUSHAF_PAGES pages generated successfully!"
else
    echo "  WARNING: Expected $TOTAL_MUSHAF_PAGES pages per tier."
fi

# Size summary
THUMB_SIZE=$(du -sh "$THUMB_DIR" | cut -f1)
MEDIUM_SIZE=$(du -sh "$MEDIUM_DIR" | cut -f1)
HIGH_SIZE=$(du -sh "$HIGH_DIR" | cut -f1)
TOTAL_SIZE=$(du -sh "$PROJECT_DIR/app/images/pages" | cut -f1)

echo ""
echo "  Sizes:"
echo "    Thumb:  $THUMB_SIZE"
echo "    Medium: $MEDIUM_SIZE"
echo "    High:   $HIGH_SIZE"
echo "    Total:  $TOTAL_SIZE"

# ─── Phase 4: Cleanup ───
echo ""
echo "Cleaning up temporary PNGs..."
rm -rf "$TMP_DIR"
echo "Done!"
