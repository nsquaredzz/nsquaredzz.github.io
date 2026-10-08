/**
 * blip: an original 12x12 pixel robot.
 *   C cream head, A amber body, D dim legs, d dim antenna stem, r rust antenna tip.
 * Eyes are drawn separately so they can look around and blink.
 */
export const PAL: Record<string, string> = {
  C: "#e9dfc8",
  A: "#ffb23e",
  D: "#7a7160",
  d: "#7a7160",
  r: "#d9643a",
  G: "#b6f23a",
};

const BODY = [
  "....r.......",
  "....d.......",
  "..CCCCCCCC..",
  "..CCCCCCCC..",
  "..CCCCCCCC..",
  "..CCCCCCCC..",
  "..CCCCCCCC..",
  "...AAAAAA...",
  "...AArAAA...",
  "...AAAAAA...",
];

const LEGS: string[][] = [
  ["....D..D....", "...DD..DD..."],
  ["...D....D...", "..DD....DD.."],
];

export const SPRITE = 12;

export interface EyeState {
  ox: number;   // -1..1 look offset
  oy: number;   // 0..1
  blink: boolean;
  off: boolean;
}

/** Draw blip at (x, y) = top-left in CSS px, `s` px per sprite pixel, facing `dir` (1 right, -1 left). */
export function drawBlip(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, frame: 0 | 1, dir: 1 | -1, eye: EyeState) {
  ctx.save();
  ctx.translate(x, y);
  if (dir < 0) { ctx.translate(SPRITE * s, 0); ctx.scale(-1, 1); }
  const rows = [...BODY, ...LEGS[frame]];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(c * s, r * s, s, s);
    }
  }
  // eyes: two 2x2 blocks inside the head (cols 2..9, rows 2..6)
  const ex = eye.off ? 0 : eye.ox, ey = eye.off ? 0 : eye.oy;
  const col = eye.off ? PAL.D : PAL.G;
  ctx.fillStyle = col;
  if (!eye.off && !eye.blink) {
    ctx.shadowColor = "rgba(182,242,58,.8)";
    ctx.shadowBlur = s * 1.5;
  }
  const lx = Math.min(Math.max(3 + ex, 2), 8), rx = Math.min(Math.max(7 + ex, 2), 8);
  const ty = Math.min(Math.max(4 + ey, 2), 5);
  if (eye.blink) {
    ctx.fillRect(lx * s, (ty + 1) * s, 2 * s, s);
    ctx.fillRect(rx * s, (ty + 1) * s, 2 * s, s);
  } else {
    ctx.fillRect(lx * s, ty * s, 2 * s, 2 * s);
    ctx.fillRect(rx * s, ty * s, 2 * s, 2 * s);
  }
  ctx.restore();
}
