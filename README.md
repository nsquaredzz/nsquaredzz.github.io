# niyath.nair, the terminal

my personal site. it works like a terminal: type commands, or click the buttons. a small pixel robot called **blip** lives on the page, wanders around, and fetches pieces of my work when you drop bits for it.

live: https://nsquaredzz.github.io

![first load, with three blips](docs/first-load.png)

## run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/
npm run preview    # serves dist/
```

vite + vanilla typescript, no framework. the production bundle is about 22 kb of js gzipped.

useful urls while developing:

- `/?plain` plain html version (also reachable with `exit`, `plain`, or the `~/plain` button)
- `/?blips=3` spawn blips on load
- `/?help` force the first-visit `help`

## layout

```
src/
  main.ts              wires everything together, first screen, buttons, chips
  content.json         everything you read on the site. edit this, not the code
  banner.ts            the ascii name banner
  status.ts            uptime, blr clock, visitors, blips online
  plain.ts             the semantic html version
  style.css            one stylesheet, one font, seven colours
  terminal/
    terminal.ts        output, prompt, history, tab completion, boxes
    parser.ts          "cmd arg --flag value" -> { cmd, args, flags }
    fs.ts              a read-only filesystem built from content.json
    commands.ts        the command registry, including the hidden ones
  sprite/
    sprite.ts          blip's pixels and how to draw them
    engine.ts          requestAnimationFrame loop, steering, bits, bubbles
public/
  fonts/               jetbrains mono, self-hosted
  resume.pdf           not in the repo yet. drop one here and the resume button starts working
```

## add content

everything on the site comes from `src/content.json`.

- `dirs.work`, `dirs.projects`, `dirs.lab`, `dirs.notes`: each entry is a file. `name` is what `ls` shows, `title`/`when`/`tag` show in listings and box titles, `body` is a list of lines. a line starting with `# ` is the heading, `- ` is a bullet, an empty line is a paragraph gap. `[label](url)` makes a link, backticks make inline code.
- `intro`: the labelled rows under the banner on the first screen. `bio` is the prose version used by `whoami` and plain mode.
- `hidden`: dotfiles that only show up with `ls -a`.
- `fetchable`: the paths blip can bring back when it fetches a bit.
- `email`: leave empty and `sudo hire niyath` points at github instead.
- `firstCommit`: what `uptime` counts from.

no code changes needed. the plain version renders from the same file.

## add a command

commands live in `src/terminal/commands.ts` as one object each:

```ts
{
  name: "hello",
  desc: "say hi",            // shown in help
  usage: "hello [name]",     // optional, replaces name in help
  group: "basics",           // which help box it lands in
  hidden: false,             // true keeps it out of help (secret commands)
  run(p, ctx) {
    ctx.term.text(`hi ${p.args[0] ?? "there"}`);
  },
}
```

`p` is the parsed line (`args`, `flags`, `raw`). `ctx` has the terminal (`print`, `text`, `openBox`/`closeBox`), the filesystem, and the blip engine (`spawn`, `kill`, `drop`, `panic`, `say`). tab completion for a command's arguments is in `main.ts` in `onComplete`.

## blip

12x12 pixels, drawn on one fullscreen canvas. the engine keeps blips in a rectangle that `main.ts` computes: right of the text column on desktop, a strip above the chips on mobile. steering is three rules: wander to a random point, avoid other blips, go to the nearest unclaimed bit. with `prefers-reduced-motion` they sit still and blink.

## deploy

### github pages (this repo)

pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes `dist/` to github pages. the repo is named `nsquaredzz.github.io` so the site lives at the root of that domain.

### vercel

```bash
npm i -g vercel
vercel          # framework: vite, build: npm run build, output: dist
```

or import the repo in the vercel dashboard. no config file is needed. if you move the site to a subpath anywhere, set `base` in `vite.config.ts`.

## colours

bone `#e9dfc8`, dim `#7a7160`, amber `#ffb23e`, green `#b6f23a`, lilac `#a99cff`, rust `#d9643a`, on warm black `#0b0a08`. nothing else.
