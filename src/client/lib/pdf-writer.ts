// A small PDF writer for reports: A4 pages, Helvetica text, filled and
// outlined boxes, lines and circles. No libraries, so it runs in the browser
// and the PDF can be downloaded or shared as a real file.
//
// Coordinates are in points from the TOP-LEFT of the page (A4 = 595 × 842).
// Text uses the PDF standard fonts with WinAnsi encoding, which covers
// English, £, – — · × and curly quotes.

export const A4 = { w: 595.28, h: 841.89 };

const WIDTHS: Record<"regular" | "bold", number[]> = {
  regular: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,222,222,333,333,350,556,1000,0,0,0,0,0,0,0,0,0,0,0,556,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,584,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  bold: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,278,500,500,350,556,1000,0,0,0,0,0,0,0,0,0,0,0,556,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,584,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// Unicode → WinAnsi for the few characters above 127 we use.
const WIN: Record<string, number> = { "£": 0xa3, "–": 0x96, "—": 0x97, "·": 0xb7, "×": 0xd7, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "•": 0x95 };

function codes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) out.push(c);
    else if (WIN[ch]) out.push(WIN[ch]);
    else if (ch === " ") out.push(32);
    else out.push(63); // "?" for anything the font can't show
  }
  return out;
}

export type RGB = [number, number, number];
export const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const col = (c: RGB) => c.map(f).join(" ");

export interface TextOpts { size?: number; bold?: boolean; color?: string; align?: "left" | "right" | "center"; maxWidth?: number }

export class PdfDoc {
  private pages: string[][] = [];
  private cur: string[] = [];

  constructor() {
    this.addPage();
  }

  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this.cur = [];
    this.pages.push(this.cur);
  }

  /** Go back to an earlier page (0-based), e.g. to write "Page 1 of 3" at the end. */
  onPage(i: number) {
    this.cur = this.pages[i];
  }

  width(text: string, size = 10, bold = false): number {
    const w = WIDTHS[bold ? "bold" : "regular"];
    return codes(text).reduce((a, c) => a + (w[c] || 556), 0) * (size / 1000);
  }

  /** Shorten text with "…"-style ".." so it fits a width. */
  fit(text: string, maxWidth: number, size = 10, bold = false): string {
    if (this.width(text, size, bold) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && this.width(`${t}...`, size, bold) > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  }

  /** Split text into lines no wider than maxWidth. */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (this.width(next, size, bold) <= maxWidth || !line) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** y is the text's baseline, measured from the top of the page. */
  text(x: number, y: number, text: string, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const bold = !!o.bold;
    const t = o.maxWidth ? this.fit(text, o.maxWidth, size, bold) : text;
    const w = this.width(t, size, bold);
    const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    const bytes = codes(t).map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c > 126 ? `\\${c.toString(8).padStart(3, "0")}` : String.fromCharCode(c))).join("");
    this.cur.push(`BT ${col(hex(o.color ?? "#1a1a1a"))} rg /${bold ? "F2" : "F1"} ${f(size)} Tf ${f(left)} ${f(A4.h - y)} Td (${bytes}) Tj ET`);
    return w;
  }

  /** A filled (and optionally outlined) box, with rounded corners if r > 0. */
  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lineWidth?: number; r?: number } = {}) {
    const ops: string[] = [];
    if (o.fill) ops.push(`${col(hex(o.fill))} rg`);
    if (o.stroke) ops.push(`${col(hex(o.stroke))} RG ${f(o.lineWidth ?? 1)} w`);
    const r = Math.min(o.r ?? 0, w / 2, h / 2);
    const X = x, Y = A4.h - y - h; // bottom-left in PDF space
    if (r > 0) {
      const k = r * 0.5523;
      ops.push(
        `${f(X + r)} ${f(Y)} m ${f(X + w - r)} ${f(Y)} l ${f(X + w - r + k)} ${f(Y)} ${f(X + w)} ${f(Y + r - k)} ${f(X + w)} ${f(Y + r)} c`,
        `${f(X + w)} ${f(Y + h - r)} l ${f(X + w)} ${f(Y + h - r + k)} ${f(X + w - r + k)} ${f(Y + h)} ${f(X + w - r)} ${f(Y + h)} c`,
        `${f(X + r)} ${f(Y + h)} l ${f(X + r - k)} ${f(Y + h)} ${f(X)} ${f(Y + h - r + k)} ${f(X)} ${f(Y + h - r)} c`,
        `${f(X)} ${f(Y + r)} l ${f(X)} ${f(Y + r - k)} ${f(X + r - k)} ${f(Y)} ${f(X + r)} ${f(Y)} c h`,
      );
    } else {
      ops.push(`${f(X)} ${f(Y)} ${f(w)} ${f(h)} re`);
    }
    ops.push(o.fill && o.stroke ? "B" : o.fill ? "f" : "S");
    this.cur.push(`q ${ops.join(" ")} Q`);
  }

  circle(cx: number, cy: number, r: number, fill: string) {
    const X = cx, Y = A4.h - cy, k = r * 0.5523;
    this.cur.push(
      `q ${col(hex(fill))} rg ${f(X + r)} ${f(Y)} m ${f(X + r)} ${f(Y + k)} ${f(X + k)} ${f(Y + r)} ${f(X)} ${f(Y + r)} c ` +
      `${f(X - k)} ${f(Y + r)} ${f(X - r)} ${f(Y + k)} ${f(X - r)} ${f(Y)} c ${f(X - r)} ${f(Y - k)} ${f(X - k)} ${f(Y - r)} ${f(X)} ${f(Y - r)} c ` +
      `${f(X + k)} ${f(Y - r)} ${f(X + r)} ${f(Y - k)} ${f(X + r)} ${f(Y)} c f Q`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color = "#e6dcd8", width = 0.75) {
    this.cur.push(`q ${col(hex(color))} RG ${f(width)} w ${f(x1)} ${f(A4.h - y1)} m ${f(x2)} ${f(A4.h - y2)} l S Q`);
  }

  /** The finished file. */
  toBytes(title = "Report"): Uint8Array {
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(""); // filled below
    const pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const ops of this.pages) {
      const body = ops.join("\n");
      const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(A4.w)} ${f(A4.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${title.replace(/[()\\]/g, "")}) /Producer (Sphere Property Management) >>`);

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Every character above is a single byte (octal escapes for WinAnsi), so this is exact.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}
