import type { Terminal } from "../terminal/terminal";
import { BANNER_WIDE } from "../banner";

const C = { bg: "#0b0a08", bone: "#e9dfc8", dim: "#7a7160", amber: "#ffb23e", green: "#b6f23a", rust: "#d9643a" };

/** Breakout where the bricks are the cells of the ASCII banner. */
export function breakout(term: Terminal, done: (left: number, total: number) => void) {
  const bw = 6, bh = 9, cols = BANNER_WIDE[0].length, rows = BANNER_WIDE.length;
  const W = cols * bw, H = 300;
  const cv = document.createElement("canvas");
  cv.className = "game"; cv.width = W; cv.height = H; cv.tabIndex = 0;
  cv.setAttribute("aria-label", "breakout game");
  const help = document.createElement("div");
  help.className = "line game-help";
  help.textContent = "mouse or arrows to move. space to launch. esc to quit.";
  term.mount(help); term.mount(cv);
  const g = cv.getContext("2d")!;

  interface Brick { x: number; y: number; solid: boolean; alive: boolean; }
  const bricks: Brick[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = BANNER_WIDE[r][c];
    if (ch === " ") continue;
    bricks.push({ x: c * bw, y: 14 + r * bh, solid: ch === "█", alive: true });
  }
  const total = bricks.filter((b) => b.solid).length;
  const pad = { x: W / 2 - 32, w: 64, h: 5, y: H - 16 };
  const ball = { x: W / 2, y: pad.y - 5, vx: 0, vy: 0, r: 3, live: false };
  let lives = 3, raf = 0, over = false, won = false, keyL = false, keyR = false;

  function launch() { if (!ball.live && !over) { ball.live = true; ball.vx = (Math.random() < 0.5 ? -1 : 1) * 2.2; ball.vy = -3.4; } }
  function reset() { ball.live = false; ball.x = pad.x + pad.w / 2; ball.y = pad.y - 5; }

  function frame() {
    if (keyL) pad.x -= 6; if (keyR) pad.x += 6;
    pad.x = Math.max(0, Math.min(W - pad.w, pad.x));
    if (!ball.live) { ball.x = pad.x + pad.w / 2; }
    else {
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.x < ball.r || ball.x > W - ball.r) ball.vx *= -1;
      if (ball.y < ball.r) ball.vy *= -1;
      if (ball.y > H + 10) { lives--; if (lives <= 0) { over = true; } reset(); }
      if (ball.vy > 0 && ball.y + ball.r >= pad.y && ball.y - ball.r <= pad.y + pad.h && ball.x >= pad.x && ball.x <= pad.x + pad.w) {
        const hit = (ball.x - (pad.x + pad.w / 2)) / (pad.w / 2);
        const sp = Math.min(5.5, Math.hypot(ball.vx, ball.vy) + 0.05);
        const ang = hit * 1.1;
        ball.vx = Math.sin(ang) * sp; ball.vy = -Math.cos(ang) * sp;
        ball.y = pad.y - ball.r;
      }
      for (const b of bricks) {
        if (!b.alive) continue;
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + bw && ball.y + ball.r > b.y && ball.y - ball.r < b.y + bh) {
          b.alive = false;
          const ox = Math.min(ball.x + ball.r - b.x, b.x + bw - (ball.x - ball.r));
          const oy = Math.min(ball.y + ball.r - b.y, b.y + bh - (ball.y - ball.r));
          if (ox < oy) ball.vx *= -1; else ball.vy *= -1;
          break;
        }
      }
      if (!bricks.some((b) => b.alive && b.solid)) { won = true; over = true; }
    }
    draw();
    if (!over) raf = requestAnimationFrame(frame);
  }
  function draw() {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    for (const b of bricks) {
      if (!b.alive) continue;
      g.fillStyle = b.solid ? C.amber : C.dim;
      g.fillRect(b.x, b.y, bw - 1, bh - 1);
    }
    g.fillStyle = C.bone; g.fillRect(pad.x, pad.y, pad.w, pad.h);
    g.fillStyle = C.green; g.shadowColor = "rgba(182,242,58,.8)"; g.shadowBlur = 6;
    g.fillRect(ball.x - ball.r, ball.y - ball.r, ball.r * 2, ball.r * 2);
    g.shadowBlur = 0;
    g.fillStyle = C.dim; g.font = "11px 'JetBrains Mono', monospace"; g.textAlign = "left";
    g.fillText(`lives ${lives}   left ${bricks.filter((b) => b.alive && b.solid).length}/${total}`, 6, H - 4);
    if (over) {
      g.fillStyle = won ? C.green : C.rust; g.textAlign = "center"; g.font = "bold 14px 'JetBrains Mono', monospace";
      g.fillText(won ? "banner cleared. esc to leave." : "out of lives. esc to leave.", W / 2, H / 2 + 20);
    }
  }
  const move = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); pad.x = (e.clientX - r.left) * (W / r.width) - pad.w / 2; };
  cv.addEventListener("mousemove", move);
  cv.addEventListener("click", launch);
  const up = (e: KeyboardEvent) => { if (e.key === "ArrowLeft" || e.key === "a") keyL = false; if (e.key === "ArrowRight" || e.key === "d") keyR = false; };
  function quit() {
    cancelAnimationFrame(raf); cv.removeEventListener("mousemove", move); removeEventListener("keyup", up); term.capture(null);
    done(bricks.filter((b) => b.alive && b.solid).length, total);
  }
  term.capture((e) => {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "c")) { e.preventDefault(); quit(); return; }
    if (e.key === " ") { e.preventDefault(); launch(); }
    if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); keyL = e.type === "keydown"; }
    if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); keyR = e.type === "keydown"; }
  });
  addEventListener("keyup", up);
  frame();
}
