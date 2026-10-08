import { drawBlip, SPRITE, SCENE } from "./sprite";

export interface Rect { x: number; y: number; w: number; h: number; }

type State = "wander" | "fetch" | "down" | "flee" | "return" | "gone" | "sit";

interface Bit { x: number; y: number; ch: "0" | "1"; claimed: boolean; }
interface Dot { x: number; y: number; t: number; }

export interface Blip {
  x: number; y: number;          // top-left of sprite in CSS px
  vx: number; vy: number;
  scale: number;
  dir: 1 | -1;
  state: State;
  target: { x: number; y: number } | null;
  bit: Bit | null;
  until: number;                 // state timer (ms timestamp)
  walkT: number;
  blinkAt: number;
  blinkUntil: number;
  hopT: number;                  // >0 while hopping, counts down in seconds
  trailD: number;
  bubble: HTMLElement | null;
  bubbleUntil: number;
  seed: number;
}

export interface EngineOpts {
  bounds: () => Rect;            // where blips may walk
  mobile: () => boolean;
  reduced: boolean;
  onFetch: (b: Blip) => void;    // called when a blip picks up a bit
}

const MAX = 8;

/** requestAnimationFrame loop, steering, sprites. */
export class Engine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  blips: Blip[] = [];
  private bits: Bit[] = [];
  private dots: Dot[] = [];
  private mouse = { x: -1e4, y: -1e4 };
  private last = 0;
  private dpr = Math.min(devicePixelRatio || 1, 2);
  private bubbleLayer: HTMLElement;

  constructor(private opts: EngineOpts) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "stage";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    this.bubbleLayer = document.createElement("div");
    this.bubbleLayer.id = "bubbles";
    document.body.append(this.canvas, this.bubbleLayer);
    this.resize();
    addEventListener("resize", () => this.resize());
    addEventListener("mousemove", (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }, { passive: true });
    addEventListener("click", (e) => this.click(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    const r = this.opts.bounds();
    for (const b of this.blips) if (b.state !== "flee" && b.state !== "gone") this.clamp(b, r);
  }

  get count() { return this.blips.filter((b) => b.state !== "gone").length; }

  spawn(big = false): Blip | null {
    if (this.count >= MAX) return null;
    const r = this.opts.bounds();
    const scale = big ? (this.opts.mobile() ? 8 : 14) : (this.opts.mobile() ? 4 : 5);
    const size = SPRITE * scale;
    const b: Blip = {
      x: r.x + Math.random() * Math.max(1, r.w - size),
      y: r.y + Math.random() * Math.max(1, r.h - size),
      vx: 0, vy: 0, scale, dir: Math.random() < 0.5 ? 1 : -1,
      state: this.opts.reduced ? "sit" : "wander",
      target: null, bit: null, until: 0, walkT: 0,
      blinkAt: performance.now() + 1500 + Math.random() * 3000, blinkUntil: 0,
      hopT: 0.45, trailD: 0, bubble: null, bubbleUntil: 0, seed: Math.random() * 1000,
    };
    this.clamp(b, r);
    this.blips.push(b);
    return b;
  }

  /** Power one down (eyes dark), reboot after a few seconds. */
  kill(): boolean {
    const b = [...this.blips].reverse().find((x) => x.state !== "down" && x.state !== "gone");
    if (!b) return false;
    b.state = "down";
    b.until = performance.now() + 4000 + Math.random() * 1500;
    b.vx = b.vy = 0;
    this.say(b, "powering down", "plain", 1500);
    return true;
  }

  killAll(): number {
    const n = this.count;
    for (const b of this.blips) { b.state = "flee"; b.until = Infinity; b.bit = null; this.unsay(b); }
    this.bits.length = 0;
    return n;
  }

  /** rm -rf /: everyone panics, hides off-screen, comes back. */
  panic() {
    const now = performance.now();
    for (const b of this.blips) {
      if (b.state === "gone") continue;
      b.state = "flee";
      b.until = now + 3500 + Math.random() * 1200;
      b.bit = null;
      this.say(b, "!!", "rust", 1200);
    }
  }

  /** Drop a bit at (x,y) or somewhere random in bounds. */
  drop(x?: number, y?: number): boolean {
    const r = this.opts.bounds();
    if (x === undefined || y === undefined) {
      x = r.x + 20 + Math.random() * Math.max(1, r.w - 40);
      y = r.y + 20 + Math.random() * Math.max(1, r.h - 40);
    }
    if (this.bits.length > 12) this.bits.shift();
    this.bits.push({ x, y, ch: Math.random() < 0.5 ? "0" : "1", claimed: false });
    return true;
  }

  say(b: Blip, text: string, cls: "fetch" | "plain" | "rust", ms: number, onClick?: () => void) {
    this.unsay(b);
    const el = document.createElement("div");
    el.className = "bubble" + (cls === "fetch" ? "" : " " + cls);
    el.textContent = text;
    if (onClick) el.addEventListener("click", (e) => { e.stopPropagation(); onClick(); this.unsay(b); });
    this.bubbleLayer.appendChild(el);
    b.bubble = el;
    b.bubbleUntil = performance.now() + ms;
  }

  private unsay(b: Blip) { b.bubble?.remove(); b.bubble = null; }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest(".term, .side, .bubble, .chips, .status, button, a")) return;
    const r = this.opts.bounds();
    const inside = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
    let near = false;
    for (const b of this.blips) {
      if (b.state === "gone" || b.state === "down") continue;
      const cx = b.x + SPRITE * b.scale / 2, cy = b.y + SPRITE * b.scale / 2;
      if (Math.hypot(cx - e.clientX, cy - e.clientY) < SPRITE * b.scale * 0.9) { b.hopT = 0.45; near = true; }
    }
    if (!near && inside && this.count > 0) this.drop(e.clientX, e.clientY);
  }

  private clamp(b: Blip, r: Rect) {
    const size = SPRITE * b.scale;
    b.x = Math.min(Math.max(b.x, r.x), Math.max(r.x, r.x + r.w - size));
    b.y = Math.min(Math.max(b.y, r.y), Math.max(r.y, r.y + r.h - size));
  }

  private pickTarget(b: Blip, r: Rect) {
    const size = SPRITE * b.scale;
    const reach = 90 + Math.random() * 220;
    const ang = Math.random() * Math.PI * 2;
    b.target = {
      x: Math.min(Math.max(b.x + Math.cos(ang) * reach, r.x), Math.max(r.x, r.x + r.w - size)),
      y: Math.min(Math.max(b.y + Math.sin(ang) * reach, r.y), Math.max(r.y, r.y + r.h - size)),
    };
    b.until = performance.now() + 2500 + Math.random() * 4000; // pause after reaching
  }

  private frame(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    const r = this.opts.bounds();
    const W = innerWidth, H = innerHeight;
    const now = t;

    // assign unclaimed bits to nearest free blip
    for (const bit of this.bits) {
      if (bit.claimed) continue;
      let best: Blip | null = null, bd = Infinity;
      for (const b of this.blips) {
        if (b.state !== "wander" && b.state !== "sit") continue;
        const d = Math.hypot(b.x - bit.x, b.y - bit.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) { bit.claimed = true; best.bit = bit; best.state = "fetch"; }
    }

    for (const b of this.blips) {
      const size = SPRITE * b.scale;
      const speed = b.state === "flee" ? 420 : b.state === "fetch" ? 95 : 42;
      let tx: number | null = null, ty: number | null = null;

      switch (b.state) {
        case "sit":
          b.vx = b.vy = 0;
          break;
        case "wander":
          if (!b.target) { if (now > b.until) this.pickTarget(b, r); }
          else { tx = b.target.x; ty = b.target.y; }
          break;
        case "fetch":
          if (!b.bit || !this.bits.includes(b.bit)) { b.bit = null; b.state = "wander"; b.target = null; b.until = now; break; }
          tx = b.bit.x - size / 2; ty = b.bit.y - size * 0.8;
          if (Math.hypot(tx - b.x, ty - b.y) < 6) {
            this.bits.splice(this.bits.indexOf(b.bit), 1);
            b.bit = null; b.state = this.opts.reduced ? "sit" : "wander"; b.target = null; b.until = now + 4000;
            b.hopT = 0.45;
            this.opts.onFetch(b);
          }
          break;
        case "down":
          b.vx = b.vy = 0;
          if (now > b.until) { b.state = this.opts.reduced ? "sit" : "wander"; b.target = null; b.until = now; b.hopT = 0.45; this.say(b, "rebooted. ok.", "plain", 1800); }
          break;
        case "flee": {
          // run to the nearest horizontal edge
          const cx = b.x + size / 2;
          tx = cx < W / 2 ? -size * 2 : W + size * 2; ty = b.y;
          const off = b.x < -size - 10 || b.x > W + 10;
          if (off) {
            if (b.until === Infinity) b.state = "gone";
            else if (now > b.until) { b.state = "return"; b.target = { x: r.x + Math.random() * Math.max(1, r.w - size), y: r.y + Math.random() * Math.max(1, r.h - size) }; }
            else { tx = null; ty = null; b.vx = b.vy = 0; }
          }
          break;
        }
        case "return":
          tx = b.target!.x; ty = b.target!.y;
          if (Math.hypot(tx - b.x, ty - b.y) < 4) { b.state = this.opts.reduced ? "sit" : "wander"; b.target = null; b.until = now + 1000; }
          break;
        case "gone":
          continue;
      }

      // steering: seek target with gentle acceleration, mild separation
      if (tx !== null && ty !== null) {
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        if (d < 3 && b.state === "wander") { b.target = null; b.vx = b.vy = 0; }
        else {
          const sp = Math.min(speed, d * 3);
          const wx = (dx / (d || 1)) * sp, wy = (dy / (d || 1)) * sp;
          b.vx += (wx - b.vx) * Math.min(1, dt * 6);
          b.vy += (wy - b.vy) * Math.min(1, dt * 6);
        }
      } else if (b.state === "wander") {
        b.vx *= 0.8; b.vy *= 0.8;
      }
      if (b.state === "wander" || b.state === "fetch") {
        for (const o of this.blips) {
          if (o === b || o.state === "gone") continue;
          const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
          if (d > 0 && d < size * 0.9) { b.vx += (dx / d) * 30 * dt * 4; b.vy += (dy / d) * 30 * dt * 4; }
        }
      }
      const px = b.x, py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.state !== "flee" && b.state !== "return") this.clamp(b, r);
      const moved = Math.hypot(b.x - px, b.y - py);
      if (Math.abs(b.vx) > 4) b.dir = b.vx > 0 ? 1 : -1;
      if (moved > 0.2) {
        b.walkT += moved;
        b.trailD += moved;
        if (b.trailD > 14) { b.trailD = 0; this.dots.push({ x: b.x + size / 2 + (Math.random() - 0.5) * size * 0.4, y: b.y + size - 1, t: now }); }
      }
      if (b.hopT > 0) b.hopT -= dt;

      // blink
      if (now > b.blinkAt) { b.blinkUntil = now + 140; b.blinkAt = now + 1800 + Math.random() * 4000; }

      // bubble expiry
      if (b.bubble && now > b.bubbleUntil) this.unsay(b);
    }

    // sweep gone blips
    this.blips = this.blips.filter((b) => b.state !== "gone" || (b.bubble && this.unsay(b), false));
    this.dots = this.dots.filter((d) => now - d.t < 1600);

    this.draw(now, W, H);
    requestAnimationFrame((t2) => this.frame(t2));
  }

  private draw(now: number, W: number, H: number) {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    // on mobile the playground is a floor strip above the chips; give it a solid ground so text never shows through
    if (this.opts.mobile()) {
      const r = this.opts.bounds();
      c.fillStyle = SCENE.bg;
      c.fillRect(0, r.y - 10, W, H - r.y + 10);
      c.fillStyle = SCENE.rule;
      c.fillRect(0, r.y + r.h + 2, W, 1);
    }

    // trail dots
    for (const d of this.dots) {
      const a = 1 - (now - d.t) / 1600;
      c.fillStyle = `rgba(${SCENE.dot},${(a * 0.9).toFixed(2)})`;
      c.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
    }

    // bits
    c.font = "bold 13px 'JetBrains Mono', monospace";
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const bit of this.bits) {
      const bob = Math.sin(now / 250 + bit.x) * 2;
      c.fillStyle = SCENE.bit;
      c.shadowColor = "rgba(182,242,58,.7)"; c.shadowBlur = SCENE.bitGlow;
      c.fillText(bit.ch, bit.x, bit.y + bob);
      c.shadowBlur = 0;
    }

    for (const b of this.blips) {
      const size = SPRITE * b.scale;
      const cx = b.x + size / 2, cy = b.y + size * 0.4;
      const mdx = this.mouse.x - cx, mdy = this.mouse.y - cy;
      let ox = 0, oy = 0;
      if (Math.abs(mdx) > 24) ox = mdx > 0 ? 1 : -1;
      if (mdy > 30) oy = 1;
      if (b.dir < 0) ox = -ox; // sprite is mirrored
      const hop = b.hopT > 0 ? Math.sin((0.45 - b.hopT) / 0.45 * Math.PI) * size * 0.3 : 0;
      const frame: 0 | 1 = Math.floor(b.walkT / 18) % 2 === 0 ? 0 : 1;
      const idle = Math.abs(b.vx) + Math.abs(b.vy) < 2 ? 0 : frame;
      drawBlip(c, Math.round(b.x), Math.round(b.y - hop), b.scale, idle, b.dir, {
        ox, oy, blink: now < b.blinkUntil, off: b.state === "down",
      });
      if (b.bubble) {
        b.bubble.style.left = Math.round(cx) + "px";
        b.bubble.style.top = Math.round(b.y - hop - 6) + "px";
      }
    }
  }
}
