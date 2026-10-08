"""Turn posts/escaping-flatland.md into the React component used by the comic-style blog.

One source of truth: the markdown post in this repository. This script maps its blocks onto the
blog's own primitives (IssueHeader, SectionStamp, Admonition, Figure, PullQuote, DropCap), so both
sites carry the same words, equations, tables and numbers.

    python3 scripts/export_comic.py <blog checkout> <light figures dir>

    <blog checkout>      a clone of github.com/Niyathnair/Blog
    <light figures dir>  figures/light in a clone of github.com/nsquaredzz/escaping-flatland

Writes src/components/essay/EscapingFlatland.tsx in the blog and copies the figures to its
public/issues/escaping-flatland/. Needs pillow.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
POST = os.path.join(HERE, "..", "posts", "escaping-flatland.md")
LIGHT = ""          # set from the command line
ACCENTS = ["yellow", "cyan", "red", "green"]
SLUG = "escaping-flatland"


def js(s: str) -> str:
    """A JSX string expression: safe for quotes, braces and angle brackets."""
    return "{" + json.dumps(s, ensure_ascii=False) + "}"


def tex(s: str) -> str:
    return "{" + json.dumps(s.strip(), ensure_ascii=False) + "}"


INLINE = re.compile(
    r"(?P<math>\$[^$\n]+?\$)|(?P<code>`[^`]+`)|(?P<bold>\*\*.+?\*\*)|(?P<ital>\*[^*\n]+?\*)|(?P<link>\[[^\]]+\]\([^)]+\))"
)


def inline(text: str) -> str:
    out, pos = [], 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            out.append(js(text[pos:m.start()]))
        tok = m.group(0)
        if m.lastgroup == "math":
            out.append(f"<M tex={tex(tok[1:-1])} />")
        elif m.lastgroup == "code":
            out.append(f"<code>{js(tok[1:-1])}</code>")
        elif m.lastgroup == "bold":
            out.append(f"<strong>{inline(tok[2:-2])}</strong>")
        elif m.lastgroup == "ital":
            out.append(f"<em>{inline(tok[1:-1])}</em>")
        else:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", tok).groups()
            ext = ' target="_blank" rel="noopener noreferrer"' if url.startswith("http") else ""
            out.append(f"<a href={js(url)}{ext}>{inline(label)}</a>")
        pos = m.end()
    if pos < len(text):
        out.append(js(text[pos:]))
    return "".join(out)


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\$[^$]*\$", "", s).lower()).strip("-")


def frontmatter(src: str):
    m = re.match(r"^---\n(.*?)\n---\n", src, re.S)
    meta = dict(line.split(":", 1) for line in m.group(1).split("\n") if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, src[m.end():]


def blocks(body: str):
    """Yield (kind, payload) for each top-level block of the markdown subset the post uses."""
    lines = body.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line.startswith(":::") and line.strip() != ":::":
            kind, _, title = line[3:].partition(" ")
            j = i + 1
            while lines[j].strip() != ":::":
                j += 1
            yield "env", (kind, title.strip(), "\n".join(lines[i + 1:j]))
            i = j + 1
        elif line.startswith("$$"):
            if line.strip() == "$$":
                j = i + 1
                while lines[j].strip() != "$$":
                    j += 1
                yield "math", "\n".join(lines[i + 1:j])
                i = j + 1
            else:
                yield "math", line.strip().strip("$")
                i += 1
        elif line.startswith("## "):
            yield "h2", line[3:].strip()
            i += 1
        elif line.startswith("### "):
            yield "h3", line[4:].strip()
            i += 1
        elif line.startswith("!["):
            m = re.match(r"!\[(.*)\]\(([^)]+)\)\s*$", line)
            yield "img", (m.group(1), m.group(2))
            i += 1
        elif line.startswith("|"):
            j = i
            while j < len(lines) and lines[j].startswith("|"):
                j += 1
            yield "table", lines[i:j]
            i = j
        elif line.startswith("> "):
            j = i
            while j < len(lines) and lines[j].startswith(">"):
                j += 1
            parts = [p.strip() for p in "\n".join(l[1:].strip() for l in lines[i:j]).split("\n\n") if p.strip()]
            yield "quote", parts
            i = j
        elif re.match(r"^(- |\d+\. )", line):
            ordered = not line.startswith("- ")
            j, items = i, []
            while j < len(lines) and re.match(r"^(- |\d+\. )", lines[j]):
                items.append(re.sub(r"^(- |\d+\. )", "", lines[j]))
                j += 1
            yield ("ol" if ordered else "ul"), items
            i = j
        else:
            j = i
            while j < len(lines) and lines[j].strip() and not re.match(r"^(:::|\$\$|## |### |!\[|\||> |- |\d+\. )", lines[j]):
                j += 1
            yield "p", " ".join(l.strip() for l in lines[i:j])
            i = j


def table(rows: list[str]) -> str:
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[2:]
    wide = len(head) >= 7                               # shrink wide tables so every column fits the page
    pad, size = ("px-1", "text-[10px]") if wide else ("px-3", "text-[13px]")
    th = "".join(f'<th className="border-b-[3px] border-black {pad} py-2 text-left font-mono {"text-[10.5px]" if wide else "text-[12px]"} uppercase tracking-wider">{inline(c)}</th>' for c in head)
    trs = "".join("<tr>" + "".join(f'<td className="border-b border-black/20 {pad} py-1.5 font-mono {size} whitespace-nowrap">{inline(c)}</td>' for c in r) + "</tr>" for r in body)
    return f'<div className="overflow-x-auto bg-[#fffdf2]"><table className="w-full border-collapse"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'


class State:
    section = 0
    figure = 0
    accent = 0
    first_para = True
    toc: list[tuple[str, str]] = []


def render(kind, payload, st: State, blog_public: str) -> str:
    if kind == "h2":
        ident = slugify(payload)
        plain = re.sub(r"\$[^$]*\$", "", payload).strip()
        if re.match(r"(?i)references|notes|further reading", payload):
            st.toc.append((ident, plain))
            return f'\n        <h3 id="{ident}" className="font-display text-3xl tracking-widest mt-14 mb-3">{js(plain.upper())}</h3>'
        num = f"{st.section:02d}"
        st.section += 1
        st.accent += 1
        st.first_para = True
        st.toc.append((ident, f"{num} · {plain.split(':')[0][:40]}"))
        short = plain.split(":")[0][:28]
        return (f'\n        <SectionStamp number="{num}" label={js(short)} accent="{ACCENTS[st.accent % 4]}" />'
                f'\n        <h2 id="{ident}">{inline(payload)}</h2>')
    if kind == "h3":
        return f'\n        <h3 id="{slugify(payload)}">{inline(payload)}</h3>'
    if kind == "p":
        if st.first_para and st.section == 1:
            st.first_para = False
            return f"\n        <DropCap>{inline(payload)}</DropCap>"
        st.first_para = False
        return f"\n        <p>{inline(payload)}</p>"
    if kind in ("ul", "ol"):
        cls = ' className="font-serif"' if kind == "ol" else ""
        return f"\n        <{kind}{cls}>" + "".join(f"\n          <li>{inline(i)}</li>" for i in payload) + f"\n        </{kind}>"
    if kind == "quote":
        attribution = f" attribution={js(payload[-1])}" if len(payload) > 1 else ""
        return f"\n        <PullQuote{attribution}>{inline(' '.join(payload[:-1] if len(payload) > 1 else payload))}</PullQuote>"
    if kind == "math":
        return f"\n        <MathDisplay tex={tex(payload)} />"
    if kind == "table":
        return "\n        " + table(payload)
    if kind == "img":
        caption, src = payload
        st.figure += 1
        st.accent += 1
        w, h = Image.open(os.path.join(LIGHT, src)).size
        if blog_public:
            os.makedirs(blog_public, exist_ok=True)
            shutil.copy(os.path.join(LIGHT, src), os.path.join(blog_public, src))
        return (f'\n        <Figure no={{{st.figure}}} caption={{<>{inline(caption)}</>}} accent="{ACCENTS[st.accent % 4]}" plain>'
                f'\n          <Image src="/issues/{SLUG}/{src}" alt={js("Figure " + str(st.figure))} width={{{w}}} height={{{h}}} className="w-full h-auto block" />'
                f"\n        </Figure>")
    if kind == "env":
        env, title, inner = payload
        body = "".join(render(k, p, st, blog_public) for k, p in blocks(inner))
        if env == "abstract":
            return f'\n        <section id="abstract" className="abstract-block mt-10 mb-12">{body}\n        </section>'
        if env in ("note", "remark"):
            variant = ' variant="warning"' if title.lower().startswith("correction") else ""
            return f'\n        <Admonition title={js((title or "Note").upper())}{variant}>{body}\n        </Admonition>'
        if env in ("definition", "theorem", "proposition", "lemma"):
            st.accent += 1
            m = re.match(r"(Equation|Theorem|Proposition|Lemma|Definition)\s+(\d+)\.\s*(.*)", title)
            label, no, cap = (m.group(1)[:2].upper() if m.group(1) == "Equation" else m.group(1).upper(), m.group(2), m.group(3)) if m else ("EQ", "0", title)
            return (f'\n        <Figure no={{{no}}} label="{label}" caption={{<>{inline(cap)}</>}} accent="{ACCENTS[st.accent % 4]}">{body}\n        </Figure>')
        if env == "tbl":
            st.accent += 1
            m = re.match(r"\*\*(Table|Listing)\s+(\d+)\.\*\*\s*(.*)", title)
            label, no, cap = (m.group(1).upper(), m.group(2), m.group(3)) if m else ("TABLE", "0", title)
            return (f'\n        <Figure no={{{no}}} label="{label}" caption={{<>{inline(cap)}</>}} accent="{ACCENTS[st.accent % 4]}" plain>{body}\n        </Figure>')
    raise ValueError(kind)


def main():
    global LIGHT
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    blog, LIGHT = sys.argv[1], sys.argv[2]
    post = sys.argv[3] if len(sys.argv) > 3 else POST
    meta, body = frontmatter(open(post).read())
    st = State()
    public = os.path.join(blog, "public", "issues", SLUG) if blog else ""
    parts = [render(k, p, st, public) for k, p in blocks(body)]
    # same reading-time rule as scripts/build-posts.mjs: prose only, no tables, captions or display maths
    prose = " ".join(l for l in body.split("\n") if not l.startswith(("|", ":::", "![")))
    words = len(re.sub(r"\$[^$]+\$", " x ", re.sub(r"\$\$.*?\$\$", " ", prose, flags=re.S)).split())
    toc = ",\n".join(f"  {{ id: {json.dumps(i)}, label: {json.dumps(l)} }}" for i, l in [("abstract", "Abstract")] + st.toc)
    out = f'''"use client";

/* Generated from posts/escaping-flatland.md in the nsquaredzz.github.io repository
   by scripts/export_comic.py. Edit the markdown, then re-run the script. */

import Image from "next/image";
import {{ Panel }} from "@/components/ui/Panel";
import {{ Admonition, DropCap, Figure, IssueHeader, PullQuote, SectionStamp }} from "./Primitives";
import {{ M, MathDisplay }} from "./Math";
import IssueTOC, {{ type TocEntry }} from "./IssueTOC";
import ReadProgress from "./ReadProgress";

const TOC: TocEntry[] = [
{toc},
];

export default function EscapingFlatland() {{
  return (
    <>
      <ReadProgress />
      <IssueTOC entries={{TOC}} />

      <article className="relative w-full max-w-[860px] mx-auto px-5 sm:px-8 pt-6 pb-32 prose-comic">
        <IssueHeader
          issueNo="ISSUE #002"
          series="ESCAPING FLATLAND"
          title="Escaping Flatland."
          subtitle={json.dumps(meta["subtitle"], ensure_ascii=False)}
          status="LIVE / TESTED EDITION"
          confidence="measured"
          importance={{10}}
          readMinutes={{{max(1, round(words / 220))}}}
          date="{meta["date"]}"
          modified="{meta.get("revised", meta["date"])}"
        />
{"".join(parts)}

        <Panel accent="green" tilt={{-1.2}} className="mt-16 text-center">
          <div className="font-display text-3xl sm:text-4xl tracking-widest leading-tight">
            END OF ISSUE&nbsp;#002
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-[0.3em] opacity-80">
            escaping flatland · hyperbolic context manifold
          </div>
        </Panel>
      </article>
    </>
  );
}}
'''
    if blog:
        path = os.path.join(blog, "src", "components", "essay", "EscapingFlatland.tsx")
        open(path, "w").write(out)
        print("wrote", path, f"({len(out) // 1024} KB, {st.section} sections, {st.figure} figures)")
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
