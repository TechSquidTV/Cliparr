import assert from "node:assert/strict";
import test from "node:test";
import { markdownPath, prefersMarkdown } from "@/lib/markdown";
import { pageMarkdown } from "@/lib/markdownExport";

void test("negotiation honors explicit preferences, exclusions, and HTML defaults", () => {
  for (const accept of [
    null,
    "*/*",
    "text/*",
    "text/html",
    "text/markdown;q=0",
    "text/markdown;q=0.2,text/html;q=0.9",
    "text/markdown;q=invalid",
    "text/markdown;q=2",
  ]) {
    assert.equal(prefersMarkdown(accept), false, String(accept));
  }
  for (const accept of [
    "text/markdown",
    "text/markdown,text/html",
    "text/markdown;q=0.9,text/html;q=0.5",
    "TEXT/MARKDOWN; charset=utf-8",
    "text/markdown;q=0.5,text/html;q=0,*/*;q=1",
  ]) {
    assert.equal(prefersMarkdown(accept), true, accept);
  }
  assert.equal(markdownPath("/"), "/index.md");
  assert.equal(markdownPath("/docs/setup/"), "/docs/setup/index.md");
  assert.equal(markdownPath("/docs/setup"), "/docs/setup/index.md");
});

void test("rendered MDX keeps commands, warning callouts, tables, and resolved links", async () => {
  const markdown = await pageMarkdown(
    `<!doctype html><html><head><meta name="description" content="Setup instructions"></head><body>
    <header>Global navigation</header><main><h1>Install</h1>
    <aside data-markdown-exclude>Docs sidebar</aside>
    <aside><p>Stable APP_KEY required</p><p>Keep this secret.</p></aside>
    <figure><label>Linux</label><input type="radio"><button>Copy command</button><pre data-language="bash"><code><span>docker run cliparr</span>\n<span>echo ready</span></code></pre></figure>
    <table><thead><tr><th>Variable</th><th>Default</th></tr></thead><tbody><tr><td>PORT</td><td>7171</td></tr></tbody></table>
    <a href="../providers/">Providers</a><img src="/docs/example.webp" alt="Editor">
    <script>secretScript()</script><style>.noise{}</style></main><footer>Footer noise</footer></body></html>`,
    "https://cliparr.dev/docs/setup/",
  );
  assert.match(markdown, /# Install/u);
  assert.ok(markdown.includes(String.raw`Stable APP\_KEY required`));
  assert.match(markdown, /```bash\ndocker run cliparr\necho ready\n```/u);
  assert.match(markdown, /\| PORT\s*\| 7171/u);
  assert.match(
    markdown,
    /\[Providers\]\(https:\/\/cliparr.dev\/docs\/providers\/\)/u,
  );
  assert.match(
    markdown,
    /!\[Editor\]\(https:\/\/cliparr.dev\/docs\/example.webp\)/u,
  );
  assert.doesNotMatch(
    markdown,
    /Global navigation|Docs sidebar|Copy command|secretScript|Footer noise|<script|<input/u,
  );
});
