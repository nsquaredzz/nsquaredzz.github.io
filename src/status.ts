import type { Content } from "./terminal/fs";
import { recordVisit } from "./visits";

export function istNow(): Date {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000);
}
export function istHour(): number { return istNow().getHours(); }

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function loginLine(): string {
  const d = istNow();
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  return `last login: ${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${hh}:${mm} on ttys002 from bengaluru`;
}

export function uptime(since: string): string {
  let s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Top-right status: uptime, BLR clock, visitors today, blips online, availability. */
export function mountStatus(content: Content, blipCount: () => number): HTMLElement {
  const el = document.createElement("div");
  el.className = "status";
  el.setAttribute("aria-live", "off");
  let visitors: string = "…";
  let allTime = "";
  // our own backend (worker/): unique people today, and visits so far. see src/visits.ts
  void recordVisit().then((c) => {
    visitors = c ? String(c.today) : "–";
    allTime = c ? String(c.total) : "";
  });
  const tick = () => {
    const d = istNow();
    const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    el.innerHTML =
      `<span class="k">uptime</span> <span class="v">${uptime(content.firstCommit)}</span><span class="sep"></span><br>` +
      `<span class="k">blr</span> <span class="v">${clock} ist</span><span class="sep"></span><br>` +
      `<span class="k">visitors today</span> <span class="v">${visitors}</span><span class="sep"></span><br>` +
      (allTime ? `<span class="k">visits all time</span> <span class="v">${allTime}</span><span class="sep"></span><br>` : "") +
      `<span class="k">blips online</span> <span class="v">${blipCount()}</span><span class="sep"></span><br>` +
      `<span class="ok">●</span> ${content.status}`;
  };
  tick();
  setInterval(tick, 1000);
  return el;
}
