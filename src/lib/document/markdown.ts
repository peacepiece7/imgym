import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

markdown.renderer.rules.image = (tokens, index) => {
  const alt = tokens[index].content.trim();
  if (!alt) return "";
  return `<span class="image-alt">[${markdown.utils.escapeHtml(alt)}]</span>`;
};

export function renderDocumentMarkdown(source: string) {
  return markdown.render(source);
}

