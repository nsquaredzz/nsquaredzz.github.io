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
