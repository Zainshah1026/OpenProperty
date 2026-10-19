// Letters are stored as HTML and shown back in the page, so only plain
// document markup is allowed through: no scripts, styles, links or handlers.

const TAGS = new Set([
  "P", "BR", "HR", "DIV", "SPAN", "SECTION", "HEADER", "STRONG", "B", "EM", "I", "U", "S", "SMALL", "SUB", "SUP",
  "H1", "H2", "H3", "H4", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "BLOCKQUOTE",
]);
const ATTRS = new Set(["class", "colspan", "rowspan"]);

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!TAGS.has(child.tagName)) {
        // Keep the text of unknown inline wrappers (e.g. FONT); drop the rest.
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "IMG", "SVG", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(child.tagName)) {
          child.remove();
          continue;
        }
        const frag = doc.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        walk(el);
        return;
      }
      for (const a of [...child.attributes]) if (!ATTRS.has(a.name.toLowerCase())) child.removeAttribute(a.name);
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
