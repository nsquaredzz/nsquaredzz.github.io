import type { Content, FileEntry } from "./terminal/fs";
import { esc } from "./terminal/terminal";
import { wireToggle } from "./theme";

function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}" rel="noopener">${t}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function body(f: FileEntry): string {
  let html = "", list = false;
  for (const line of f.body) {
    if (line.startsWith("# ")) continue; // title is the h3
    if (line.startsWith("- ")) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += "</ul>";
  return html;
}

/** Semantic single-column version of everything. For recruiters, screen readers, and ?plain. */
export function renderPlain(root: HTMLElement, c: Content) {
  document.title = `${c.name} — plain`;
  const section = (id: string, title: string, files: FileEntry[]) =>
    `<section id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${title}</h2>` +
    files.map((f) => `<article><h3>${esc(f.title ?? f.name)}</h3>${f.when ? `<p class="when">${esc(f.when)}</p>` : ""}${body(f)}</article>`).join("") +
    `</section>`;
  root.innerHTML = `
<main class="plain">
  <header>
    <h1>${esc(c.name)}</h1>
    <p class="lede">${esc(c.location)} · <span class="status-dot">●</span> ${esc(c.status)}</p>
    ${c.bio.map((b) => `<p>${esc(b)}</p>`).join("")}
    <nav class="nav" aria-label="sections">
      <a href="#work">work</a><a href="#projects">projects</a>${c.dirs.blog ? `<a href="#blog">blog</a>` : ""}<a href="#lab">lab</a><a href="#notes">notes</a><a href="#contact">contact</a>
      <button class="t-link" type="button" data-theme-toggle></button>
    </nav>
  </header>
  ${section("work", "work", c.dirs.work)}
  ${section("projects", "projects", c.dirs.projects)}
  ${c.dirs.blog ? `<section id="blog" aria-labelledby="blog-h"><h2 id="blog-h">blog</h2>${c.dirs.blog.map((f) => `<article><h3><a href="/blog/${f.name.replace(/\.md$/, "")}/">${esc(f.title ?? f.name)}</a></h3><p class="when">${esc([f.when, f.tag].filter(Boolean).join(" · "))}</p><p>${esc(f.body[3] ?? "")}</p></article>`).join("")}</section>` : ""}
  ${section("lab", "lab", c.dirs.lab)}
  ${section("notes", "notes", c.dirs.notes)}
  <section id="contact" aria-labelledby="contact-h">
    <h2 id="contact-h">contact</h2>
    <ul>
      ${c.email ? `<li>email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>` : ""}
      <li>github: <a href="${c.github}" rel="noopener">${esc(c.github.replace("https://", ""))}</a></li>
      ${c.linkedin ? `<li>linkedin: <a href="${c.linkedin}" rel="noopener">${esc(c.linkedin.replace("https://www.", ""))}</a></li>` : ""}
      <li>resume: <a href="${c.resume}">resume.pdf</a></li>
    </ul>
  </section>
  <a class="back" href="/">← back to the terminal</a>
</main>`;
  wireToggle(root.querySelector<HTMLElement>("[data-theme-toggle]")!);
}
