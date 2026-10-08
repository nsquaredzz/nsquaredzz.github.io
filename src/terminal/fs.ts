export interface FileEntry {
  name: string;
  title?: string;
  when?: string;
  tag?: string;
  body: string[];
  hidden?: boolean;
}

export interface Content {
  name: string;
  handle: string;
  location: string;
  firstCommit: string;
  email: string;
  github: string;
  resume: string;
  bio: string[];
  status: string;
  links: { label: string; url: string }[];
  dirs: Record<string, FileEntry[]>;
  hidden: FileEntry[];
  fetchable: string[];
}

export interface Listing {
  dirs: string[];
  files: FileEntry[];
}

/** A tiny read-only filesystem rooted at ~, built from content.json. */
export class FS {
  cwd = "~";
  private dirs = new Map<string, FileEntry[]>();
  private rootFiles: FileEntry[] = [];

  constructor(public content: Content) {
    for (const [d, files] of Object.entries(content.dirs)) this.dirs.set(d, files);
    this.rootFiles = content.hidden.map((f) => ({ ...f, hidden: true }));
    this.rootFiles.push({
      name: "contact.txt",
      body: [
        "# contact",
        content.email ? `email: ${content.email}` : "email: run `sudo hire niyath`",
        `github: ${content.github}`,
        `resume: ${content.resume}`,
      ],
    });
  }

  /** Normalise a path into ["~", "work", "anthill.txt"] style segments. */
  private segs(path: string): string[] {
    let p = path.trim();
    if (p === "" || p === "~" || p === "/") return ["~"];
    if (p.startsWith("/")) p = "~" + p;
    if (!p.startsWith("~")) p = this.cwd + "/" + p;
    const out: string[] = [];
    for (const s of p.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "~") { out.length = 0; out.push("~"); continue; }
      if (s === "..") { if (out.length > 1) out.pop(); continue; }
      out.push(s);
    }
    return out.length ? out : ["~"];
  }

  dirNames(): string[] { return [...this.dirs.keys()]; }

  isDir(path: string): boolean {
    const s = this.segs(path);
    return s.length === 1 || (s.length === 2 && this.dirs.has(s[1]));
  }

  /** Returns the canonical "~/work" form, or null if not a directory. */
  resolveDir(path: string): string | null {
    const s = this.segs(path);
    if (s.length === 1) return "~";
    if (s.length === 2 && this.dirs.has(s[1])) return "~/" + s[1];
    return null;
  }

  list(path = this.cwd, all = false): Listing | null {
    const s = this.segs(path);
    if (s.length === 1) {
      return {
        dirs: this.dirNames(),
        files: this.rootFiles.filter((f) => all || !f.hidden),
      };
    }
    if (s.length === 2 && this.dirs.has(s[1])) return { dirs: [], files: this.dirs.get(s[1])! };
    return null;
  }

  read(path: string): FileEntry | null {
    const s = this.segs(path);
    if (s.length === 2) return this.rootFiles.find((f) => f.name === s[1]) ?? null;
    if (s.length === 3) return this.dirs.get(s[1])?.find((f) => f.name === s[2]) ?? null;
    return null;
  }

  /** "~/projects/bi-gan.md" for a file in a dir, used by blip's fetch bubble. */
  canonical(path: string): string { return this.segs(path).join("/"); }

  /** Tab completion candidates for a partial path. */
  complete(partial: string): string[] {
    const slash = partial.lastIndexOf("/");
    const base = slash >= 0 ? partial.slice(0, slash + 1) : "";
    const frag = slash >= 0 ? partial.slice(slash + 1) : partial;
    const l = this.list(base || this.cwd, frag.startsWith("."));
    if (!l) return [];
    const names = [...l.dirs.map((d) => d + "/"), ...l.files.map((f) => f.name)];
    return names.filter((n) => n.startsWith(frag)).map((n) => base + n);
  }

  allPaths(): string[] {
    const out: string[] = [];
    for (const [d, files] of this.dirs) for (const f of files) out.push(`~/${d}/${f.name}`);
    return out;
  }
}
