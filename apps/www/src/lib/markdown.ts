const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu;
const inlineCodePattern = /`([^`]+)`/gu;
const boldPattern = /\*\*([^*]+)\*\*/gu;
const italicPattern = /(^|[\s(])_([^_\n]+)_/gu;
const autoLinkPattern = /(?<!["(])(https?:\/\/[^\s<]+)/gu;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(value: string) {
  return escapeHtml(value)
    .replace(linkPattern, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(boldPattern, "<strong>$1</strong>")
    .replace(italicPattern, "$1<em>$2</em>")
    .replace(inlineCodePattern, "<code>$1</code>")
    .replace(autoLinkPattern, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

export function renderReleaseMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listOpen = false;
  let codeOpen = false;
  const codeLines: string[] = [];

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  const closeCode = () => {
    if (codeOpen) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines.length = 0;
      codeOpen = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (codeOpen) {
        closeCode();
      } else {
        closeList();
        codeOpen = true;
      }
      continue;
    }

    if (codeOpen) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = /^(#{2,4})\s+(.+)$/u.exec(trimmed);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 5);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/u.exec(trimmed);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInline(listItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeCode();
  closeList();

  return html.join("\n");
}
