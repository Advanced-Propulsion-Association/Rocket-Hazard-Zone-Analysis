/**
 * buildMapSnapshot — fetch OSM tiles, stitch to canvas, draw hazard circle.
 * Returns a PNG data URL, or null on any fetch/canvas failure.
 *
 * Output canvas: 580 × 220 px (full report width, enough height for context).
 */

function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number; fx: number; fy: number } {
  const n = Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x: Math.floor(x), y: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

function calcZoom(lat: number, hazardRadius_m: number): number {
  // Target: hazard circle radius ≈ 200px on a 580px-wide canvas
  const latRad = (lat * Math.PI) / 180;
  const z = Math.log2((156543.03392 * Math.cos(latRad) * 200) / hazardRadius_m);
  return Math.max(8, Math.min(17, Math.round(z)));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const OUT_W = 580;
const OUT_H = 220;
const TILE = 256;

export async function buildMapSnapshot(
  lat: number,
  lon: number,
  hazardRadius_m: number,
): Promise<string | null> {
  try {
    const z = calcZoom(lat, hazardRadius_m);
    const { x: tx, y: ty, fx, fy } = latLonToTile(lat, lon, z);

    // Fetch 3×3 tile grid centred on (tx, ty)
    const tileImgs: (HTMLImageElement | null)[][] = [];
    for (let row = -1; row <= 1; row++) {
      const rowImgs: (HTMLImageElement | null)[] = [];
      for (let col = -1; col <= 1; col++) {
        const tileX = tx + col;
        const tileY = ty + row;
        const maxTile = Math.pow(2, z);
        // Clamp tile coords to valid range
        if (tileX < 0 || tileX >= maxTile || tileY < 0 || tileY >= maxTile) {
          rowImgs.push(null);
          continue;
        }
        try {
          const url = `https://tile.openstreetmap.org/${z}/${tileX}/${tileY}.png`;
          rowImgs.push(await loadImage(url));
        } catch {
          rowImgs.push(null);
        }
      }
      tileImgs.push(rowImgs);
    }

    // Stitch onto 768×768 canvas
    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = TILE * 3;
    stitchCanvas.height = TILE * 3;
    const ctx = stitchCanvas.getContext('2d')!;

    // Light gray background for missing tiles
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, TILE * 3, TILE * 3);

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const img = tileImgs[row][col];
        if (img) ctx.drawImage(img, col * TILE, row * TILE);
      }
    }

    // Launch site pixel on the 768×768 stitch
    // Centre tile (tx,ty) is at offset (256, 256); fractional within tile
    const launchPx = TILE + fx * TILE; // x in stitch
    const launchPy = TILE + fy * TILE; // y in stitch

    // Hazard circle radius in pixels
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
    const circleR = hazardRadius_m / metersPerPx;

    // Draw hazard circle (red dashed)
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, circleR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Draw launch site marker (blue dot + ring)
    ctx.save();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // OSM attribution
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, TILE * 3 - 18, 200, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText('© OpenStreetMap contributors', 4, TILE * 3 - 4);
    ctx.restore();

    // Crop to OUT_W × OUT_H centred on launch site
    const cropX = Math.max(0, Math.min(TILE * 3 - OUT_W, Math.round(launchPx - OUT_W / 2)));
    const cropY = Math.max(0, Math.min(TILE * 3 - OUT_H, Math.round(launchPy - OUT_H / 2)));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = OUT_W;
    outCanvas.height = OUT_H;
    const outCtx = outCanvas.getContext('2d')!;
    outCtx.drawImage(stitchCanvas, cropX, cropY, OUT_W, OUT_H, 0, 0, OUT_W, OUT_H);

    return outCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
