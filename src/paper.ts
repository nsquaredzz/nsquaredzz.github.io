import "katex/dist/katex.min.css";
import "./paper.css";

// highlight the section being read in the contents list
const links = [...document.querySelectorAll<HTMLAnchorElement>(".p-toc a")];
const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
const heads = [...document.querySelectorAll<HTMLElement>(".paper h2[id]")];
if (links.length && "IntersectionObserver" in window) {
  let current = "";
  const pick = () => {
    let id = heads[0]?.id ?? "";
    for (const h of heads) if (h.getBoundingClientRect().top < 140) id = h.id;
    if (id !== current) {
      byId.get(current)?.classList.remove("on");
      byId.get(id)?.classList.add("on");
      current = id;
    }
  };
  addEventListener("scroll", pick, { passive: true });
  pick();
}

// clips are muted loops: they play while they are on screen and rest when they are not.
// With reduced motion they stay on their poster until the reader presses play.
const clips = [...document.querySelectorAll<HTMLVideoElement>(".paper figure.clip video")];
if (clips.length) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const v of clips) { v.autoplay = false; v.pause(); v.load(); }
  } else if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }
    }, { threshold: 0.35 });
    for (const v of clips) io.observe(v);
  }
}

// reading progress, as a terminal would show it
const bar = document.createElement("div");
bar.className = "p-progress";
bar.setAttribute("aria-hidden", "true");
document.body.appendChild(bar);
const prog = () => {
  const h = document.documentElement;
  const p = h.scrollHeight - h.clientHeight;
  bar.style.transform = `scaleX(${p > 0 ? h.scrollTop / p : 0})`;
};
addEventListener("scroll", prog, { passive: true });
prog();
