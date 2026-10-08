// Turns posts/*.md into static paper pages under blog/<slug>/index.html
// and writes src/generated/posts.json for the terminal. Maths is rendered here, at build time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import katex from "katex";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postsDir = path.join(root, "posts");
const outDir = path.join(root, "blog");
const genDir = path.join(root, "src", "generated");

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&#?[a-z0-9]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function frontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

/** width/height of a lossy or lossless webp, so images reserve their space. */
function webpSize(file) {
  try {
    const b = fs.readFileSync(file);
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    if (kind === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  } catch { /* no size, no problem */ }
  return null;
}

const ENV = { theorem: "", proposition: "", lemma: "", definition: "", proof: "Proof.", remark: "", abstract: "Abstract", tbl: "", note: "" };

function render(md, slug) {
  // 1. maths out, so markdown never sees underscores, pipes or asterisks inside it
  const math = [];
  const stash = (tex, display) => {
    let html;
    try { html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: true, strict: "ignore" }); }
    catch (e) { throw new Error(`KaTeX in ${slug}: ${e.message}\n  ${tex.trim().slice(0, 120)}`); }
    math.push({ html, display, tex: tex.trim() });
    return `MATHX${math.length - 1}X`;
  };
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, t) => `\n\n${stash(t, true)}\n\n`);
  md = md.replace(/\$([^$\n]+?)\$/g, (_m, t) => stash(t, false));

  // 2. ":::kind Title" ... ":::" containers
  const lines = [];
  for (const line of md.split("\n")) {
    const open = /^:::(\w+)\s*(.*)$/.exec(line);
    if (open && open[1] in ENV) {
      const head = open[2] || ENV[open[1]];
      lines.push("", `<div class="env env-${open[1]}">`, "");
      if (head) lines.push(`<p class="env-h">${marked.parseInline(head)}</p>`, "");
    } else if (line.trim() === ":::") lines.push("", "</div>", "");
    else lines.push(line);
  }
  let html = marked.parse(lines.join("\n"), { gfm: true });

  // 3. figures, tables, heading numbers
  let fig = 0;
  html = html.replace(/<p><img src="([^"]+)" alt="([^"]*)"\s*\/?><\/p>/g, (_m, src, alt) => {
    fig++;
    const size = webpSize(path.join(root, "public", "blog", slug, src));
    const dims = size ? ` width="${size[0]}" height="${size[1]}"` : "";
    const cap = alt.replace(/MATHX(\d+)X/g, (_x, i) => math[+i].html);
    return `<figure id="fig-${fig}"><a href="/blog/${slug}/${src}"><img src="/blog/${slug}/${src}" alt="Figure ${fig}"${dims} loading="lazy" decoding="async"></a><figcaption><b>Figure ${fig}.</b> ${cap}</figcaption></figure>`;
  });
  html = html.replace(/<table>/g, '<div class="tbl-scroll"><table>').replace(/<\/table>/g, "</table></div>");

  const toc = [];
  let h2 = 0, h3 = 0;
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const plain = inner.replace(/MATHX\d+X/g, "");
    if (/^(references|acknowledg|appendix|notes|footnotes|further reading)/i.test(plain.trim()) && lvl === "2") {
      const id = slugify(plain);
      toc.push({ id, num: "", text: inner, lvl: 2 });
      return `<h2 id="${id}">${inner}</h2>`;
    }
    let num;
    if (lvl === "2") { h2++; h3 = 0; num = `${h2}`; } else { h3++; num = `${h2}.${h3}`; }
    const id = `s${num.replace(".", "-")}-${slugify(plain)}`;
    const plainText = inner.replace(/MATHX(\d+)X/g, (_x, i) => math[+i].tex.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1")).replace(/<[^>]+>/g, "");
    toc.push({ id, num, text: inner, plain: plainText, lvl: +lvl });
    return `<h${lvl} id="${id}"><span class="num">${num}</span>${inner}</h${lvl}>`;
  });

  // 4. maths back in
  const put = (s) => s
    .replace(/<p>MATHX(\d+)X<\/p>/g, (_m, i) => `<div class="eq">${math[+i].html}</div>`)
    .replace(/MATHX(\d+)X/g, (_m, i) => math[+i].html);
  return { html: put(html), toc: toc.map((t) => ({ ...t, text: put(t.text) })) };
}

const head = (title, desc, url) => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · niyath nair</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://nsquaredzz.github.io${url}">
<meta name="theme-color" content="#0b0a08">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/jetbrains-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/jetbrains-mono-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
</head>`;

const topbar = (crumb) => `<header class="p-top">
  <a class="p-crumb" href="/"><span class="ps1">niyath@nair:~/blog $</span> ${crumb}</a>
  <nav aria-label="site"><a href="/">terminal</a><a href="/blog/">blog</a><a href="/?plain">plain</a></nav>
</header>`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(genDir, { recursive: true });
const posts = [];
const files = fs.existsSync(postsDir) ? fs.readdirSync(postsDir).filter((f) => f.endsWith(".md")).sort() : [];
for (const f of files) {
  const slug = f.replace(/\.md$/, "");
  const { meta, body } = frontmatter(fs.readFileSync(path.join(postsDir, f), "utf8"));
  if (meta.draft === "true") continue;
  const { html, toc } = render(body, slug);
  const prose = body.split("\n").filter((l) => !l.startsWith("|") && !l.startsWith(":::") && !l.startsWith("![")).join(" ").replace(/\$\$[\s\S]+?\$\$/g, " ").replace(/\$[^$]+\$/g, " x ");
  const words = prose.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 220));
  const post = { slug, title: meta.title ?? slug, subtitle: meta.subtitle ?? "", date: meta.date ?? "", summary: meta.summary ?? "", tag: meta.tag ?? "", minutes, sections: toc.filter((t) => t.lvl === 2 && t.num).map((t) => t.plain) };
  posts.push(post);

  const tocHtml = toc.filter((t) => t.lvl === 2).map((t) => `<a href="#${t.id}">${t.num ? `<span class="num">${t.num}</span>` : `<span class="num"></span>`}<span>${t.text}</span></a>`).join("\n      ");
  const page = `${head(post.title, post.summary, `/blog/${slug}/`)}
<body class="paper-page">
${topbar(`cat ${slug}.md`)}
<div class="p-wrap">
  <nav class="p-toc" aria-label="contents">
    <p class="p-toc-h">contents</p>
      ${tocHtml}
  </nav>
  <article class="paper">
    <header class="p-head">
      <p class="p-kicker">${esc(post.tag || "research")} · ${esc(post.date)}${meta.revised ? ` · revised ${esc(meta.revised)}` : ""} · ${minutes} min read</p>
      <h1>${esc(post.title)}</h1>
      ${post.subtitle ? `<p class="p-sub">${esc(post.subtitle)}</p>` : ""}
      <p class="p-author">${esc(meta.author ?? "Niyath Nair")}${meta.where ? ` · ${esc(meta.where)}` : ""}</p>
    </header>
${html}
    <footer class="p-foot">
      <a href="/blog/">← all posts</a>
      <a href="/">back to the terminal →</a>
    </footer>
  </article>
</div>
<script type="module" src="/src/paper.ts"></script>
</body>
</html>
`;
  fs.mkdirSync(path.join(outDir, slug), { recursive: true });
  fs.writeFileSync(path.join(outDir, slug, "index.html"), page);
}

posts.sort((a, b) => (a.date < b.date ? 1 : -1));
const index = `${head("blog", "Research notes and write-ups by Niyath Nair.", "/blog/")}
<body class="paper-page">
${topbar("ls -lt")}
<div class="p-wrap p-wrap-narrow">
  <article class="paper">
    <header class="p-head"><h1>blog</h1><p class="p-sub">research notes and essays, set like papers.</p></header>
    <ul class="p-list">
${posts.map((p) => `      <li><a href="/blog/${p.slug}/"><span class="p-list-date">${esc(p.date)} · ${p.minutes} min</span><span class="p-list-title">${esc(p.title)}</span><span class="p-list-sum">${esc(p.summary)}</span></a></li>`).join("\n")}
    </ul>
    <footer class="p-foot"><a href="/">← back to the terminal</a></footer>
  </article>
</div>
<script type="module" src="/src/paper.ts"></script>
</body>
</html>
`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), index);
fs.writeFileSync(path.join(genDir, "posts.json"), JSON.stringify(posts, null, 2) + "\n");
console.log(`posts: ${posts.map((p) => `${p.slug} (${p.minutes} min)`).join(", ") || "none"}`);
