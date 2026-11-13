// Turns the single-file demo build into a page fragment that can be published as a
// claude.ai Artifact: a title, the styles, the app's mount point and the script, with no
// document tags of its own (the host wraps the fragment in its own document).
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-demo");
const html = await readFile(join(dist, "index.html"), "utf8");

const blocks = (tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const styles = blocks("style");
const scripts = blocks("script");
if (styles.length === 0 || scripts.length === 0) {
  throw new Error("The demo build did not inline its styles and script. Run `vite build --mode demo` first.");
}

// The dashboard is a desktop tool. On a narrow screen it keeps its desktop layout inside a
// frame that scrolls, so the page itself never scrolls sideways. The host's own reset sets a
// system font on body after the app's layered base styles, so the body type is restated here.
const frame = `
html, body { height: 100%; }
body {
  background: #ffffff;
  color: #1d1c1d;
  font-family: "Lato", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.375rem;
}
.demo-frame { height: 100%; overflow: auto; }
.demo-frame > #root { min-width: 1180px; }
`;

const page = [
  "<title>Founder Scout Dashboard</title>",
  `<style>${frame}</style>`,
  ...styles.map((css) => `<style>${css}</style>`),
  '<div class="demo-frame"><div id="root"></div></div>',
  ...scripts.map((js) => `<script type="module">${js}</script>`),
  "",
].join("\n");

const out = join(dist, "founder-scout-dashboard.html");
await writeFile(out, page, "utf8");
console.log(`Wrote ${out} (${(Buffer.byteLength(page) / 1_000_000).toFixed(2)} MB)`);
