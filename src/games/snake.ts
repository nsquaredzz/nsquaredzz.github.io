import type { Terminal } from "../terminal/terminal";

const C = { bg: "#0b0a08", bone: "#e9dfc8", dim: "#7a7160", amber: "#ffb23e", green: "#b6f23a", rust: "#d9643a" };

export function snake(term: Terminal, done: (score: number) => void) {
  const cell = 12, cols = 30, rows = 20;
  const cv = document.createElement("canvas");
  cv.className = "game";
  cv.width = cols * cell; cv.height = rows * cell;
  cv.tabIndex = 0;
  cv.setAttribute("aria-label", "snake game");
  const help = document.createElement("div");
  help.className = "line game-help";
  help.textContent = "arrows or wasd to move. esc to quit.";
  term.mount(help); term.mount(cv);
  const g = cv.getContext("2d")!;

  let body = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
  let dir = { x: 1, y: 0 }, next = dir;
  let food = place();
  let score = 0, alive = true, timer = 0, tick = 110;

  function place() {
    for (;;) {
      const p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      if (!body.some((b) => b.x === p.x && b.y === p.y)) return p;
    }
  }
  function draw() {
    g.fillStyle = C.bg; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = C.amber; g.fillRect(food.x * cell + 2, food.y * cell + 2, cell - 4, cell - 4);
    body.forEach((b, i) => {
      g.fillStyle = i === 0 ? C.green : C.bone;
      g.fillRect(b.x * cell + 1, b.y * cell + 1, cell - 2, cell - 2);
    });
    g.fillStyle = C.dim; g.font = "11px 'JetBrains Mono', monospace"; g.textAlign = "left";
    g.fillText(`score ${score}`, 6, 13);
    if (!alive) {
      g.fillStyle = C.rust; g.textAlign = "center"; g.font = "bold 14px 'JetBrains Mono', monospace";
      g.fillText("segfault. esc to leave.", cv.width / 2, cv.height / 2);
    }
  }
  function step() {
    if (!alive) return;
    dir = next;
    const h = { x: body[0].x + dir.x, y: body[0].y + dir.y };
    if (h.x < 0 || h.y < 0 || h.x >= cols || h.y >= rows || body.some((b) => b.x === h.x && b.y === h.y)) { alive = false; draw(); return; }
    body.unshift(h);
    if (h.x === food.x && h.y === food.y) { score++; food = place(); tick = Math.max(55, tick - 3); }
    else body.pop();
    draw();
    timer = setTimeout(step, tick) as unknown as number;
  }
  const keys: Record<string, { x: number; y: number }> = {
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
  };
  function quit() { clearTimeout(timer); term.capture(null); done(score); }
  term.capture((e) => {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "c")) { e.preventDefault(); quit(); return; }
    const k = keys[e.key];
    if (k) { e.preventDefault(); if (k.x !== -dir.x || k.y !== -dir.y) next = k; }
  });
  draw();
  timer = setTimeout(step, tick) as unknown as number;
}
