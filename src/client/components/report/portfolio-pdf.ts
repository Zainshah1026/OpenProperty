// The "Share my portfolio" PDF: branded, one or more A4 pages, built in the
// browser so it can be downloaded or sent straight from a phone. What goes in
// is decided by the page; this file only lays it out.

import { A4, PdfDoc } from "../../lib/pdf-writer";

export interface ReportStat { big: string; label: string; color: string }
export interface ReportColumn { label: string; weight: number; align?: "left" | "right"; bold?: boolean }
export interface ReportCompany { name: string; kind: string; lines: string[]; shareholders: string | null }
export interface ReportInput {
  today: string;
  subtitle: string;
  preparedFor: string;
  note: string;
  contact: string;
  stats: ReportStat[];
  byKind: { label: string; n: number; detail: string }[] | null;
  totalHomes: number;
  hmoNote: string | null;
  areas: { area: string; n: number }[] | null;
  companies: ReportCompany[] | null;
  table: { title: string; columns: ReportColumn[]; rows: string[][]; warnWords?: string[] } | null;
}

const M = 40; // page margin
const W = A4.w - M * 2;
const INK = "#1a1a1a";
const MUTED = "#5e5960";
const PINK = "#c8226f";
const TINT = "#fff4ef";
const LINE = "#ecdfda";
const FOOT = 48; // space kept for the footer

function logo(doc: PdfDoc, x: number, y: number, s: number) {
  doc.rect(x, y, s, s, { fill: "#f0516b", r: s * 0.25 });
  doc.rect(x + s * 0.5, y + s * 0.5, s * 0.5, s * 0.5, { fill: "#e6378f", r: s * 0.25 });
  doc.rect(x, y, s * 0.55, s * 0.55, { fill: "#ff7a59", r: s * 0.25 });
  doc.rect(x + s * 0.15, y + s * 0.15, s * 0.7, s * 0.7, { fill: "#f0516b", r: s * 0.18 });
  doc.circle(x + s * 0.75, y + s * 0.24, s * 0.06, "#ffffff");
  doc.text(x + s * 0.47, y + s * 0.62, "SPM", { size: s * 0.27, bold: true, color: "#ffffff", align: "center" });
}

function header(doc: PdfDoc, r: ReportInput) {
  const tall = !!r.preparedFor;
  const h = tall ? 120 : 104;
  doc.rect(0, 0, A4.w, h, { fill: INK });
  logo(doc, M, 26, 52);
  doc.text(M + 66, 50, "Sphere Property Management", { size: 20, bold: true, color: "#ffffff" });
  doc.text(M + 66, 69, r.subtitle, { size: 11, color: "#ffb3a1", maxWidth: W - 200 });
  if (tall) doc.text(M + 66, 92, `Prepared for ${r.preparedFor}`, { size: 10, bold: true, color: "#ffffff", maxWidth: W - 80 });
  doc.text(A4.w - M, 46, "As at", { size: 9, color: "#cfc6cb", align: "right" });
  doc.text(A4.w - M, 62, r.today, { size: 11, bold: true, color: "#ffffff", align: "right" });
  doc.rect(0, h, A4.w / 2, 4, { fill: "#ff7a59" });
  doc.rect(A4.w / 2, h, A4.w / 2, 4, { fill: "#e6378f" });
  return h + 4;
}

function smallHeader(doc: PdfDoc, r: ReportInput) {
  logo(doc, M, 22, 22);
  doc.text(M + 30, 37, "Sphere Property Management", { size: 10, bold: true });
  doc.text(A4.w - M, 37, `${r.subtitle} · ${r.today}`, { size: 9, color: MUTED, align: "right", maxWidth: W - 200 });
  doc.line(M, 52, A4.w - M, 52, LINE);
}

function sectionTitle(doc: PdfDoc, x: number, y: number, title: string) {
  doc.rect(x, y - 11, 3, 14, { fill: PINK });
  doc.text(x + 10, y, title, { size: 13, bold: true });
}

export function buildPortfolioPdf(r: ReportInput): Uint8Array {
  const doc = new PdfDoc();
  let y = header(doc, r) + 26;
  const room = (need: number) => {
    if (y + need > A4.h - FOOT) { doc.addPage(); smallHeader(doc, r); y = 80; }
  };

  // A personal note, in a soft box.
  if (r.note.trim()) {
    const lines = r.note.split(/\n+/).flatMap((p) => doc.wrap(p.trim(), W - 32, 10));
    const h = lines.length * 14 + 22;
    doc.rect(M, y, W, h, { fill: TINT, r: 8 });
    doc.rect(M, y + 10, 3, h - 20, { fill: PINK, r: 1.5 });
    lines.forEach((l, i) => doc.text(M + 16, y + 19 + i * 14, l, { size: 10 }));
    y += h + 20;
  }

  // Headline figures: four to a row.
  if (r.stats.length) {
    const gap = 10;
    const tw = (W - gap * 3) / 4;
    const th = 62;
    r.stats.forEach((s, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = M + col * (tw + gap);
      const ty = y + row * (th + gap);
      doc.rect(x, ty, tw, th, { fill: TINT, r: 8 });
      doc.rect(x, ty + 12, 3, th - 24, { fill: s.color, r: 1.5 });
      doc.text(x + 12, ty + 28, s.big, { size: s.big.length > 9 ? 15 : 19, bold: true, color: s.color, maxWidth: tw - 18 });
      doc.wrap(s.label, tw - 20, 8.5).slice(0, 2).forEach((l, j) => doc.text(x + 12, ty + 43 + j * 10, l, { size: 8.5, color: MUTED }));
    });
    y += Math.ceil(r.stats.length / 4) * (th + gap) + 22;
  }

  // How we hold them and where they are: side by side, or full width if only one.
  if (r.byKind || r.areas) {
    room(110);
    const colW = r.byKind && r.areas ? (W - 24) / 2 : W;
    let ly = y;
    let ay = y;
    if (r.byKind) {
      sectionTitle(doc, M, y, "How we hold them");
      ly = y + 22;
      const barMax = Math.min(colW * 0.42, 140);
      for (const k of r.byKind) {
        const bw = Math.max(10, barMax * (r.totalHomes ? k.n / r.totalHomes : 0));
        doc.rect(M, ly - 8, barMax, 9, { fill: "#f6e6e1", r: 4.5 });
        doc.rect(M, ly - 8, bw, 9, { fill: PINK, r: 4.5 });
        doc.text(M + barMax + 8, ly, `${k.n} ${k.label}`, { size: 9.5, bold: true, maxWidth: colW - barMax - 8 });
        if (k.detail) doc.text(M + barMax + 8, ly + 11, k.detail, { size: 8.5, color: MUTED });
        ly += k.detail ? 26 : 18;
      }
      if (r.hmoNote) for (const l of doc.wrap(r.hmoNote, colW, 8.5)) { doc.text(M, ly + 2, l, { size: 8.5, color: MUTED }); ly += 11; }
    }
    if (r.areas) {
      const ax = r.byKind ? M + colW + 24 : M;
      sectionTitle(doc, ax, y, "Where they are");
      let cx = ax;
      ay = y + 14;
      for (const a of r.areas) {
        const label = `${a.area}  ×${a.n}`;
        const w = doc.width(label, 9, true) + 18;
        if (cx + w > ax + colW) { cx = ax; ay += 24; }
        doc.rect(cx, ay, w, 18, { fill: TINT, stroke: "#f3d3c8", lineWidth: 0.6, r: 9 });
        doc.text(cx + 9, ay + 12.5, label, { size: 9, bold: true, color: PINK });
        cx += w + 6;
      }
      ay += 18;
    }
    y = Math.max(ly, ay) + 28;
  }

  // Companies and joint ventures: two cards to a row.
  if (r.companies && r.companies.length) {
    room(100);
    sectionTitle(doc, M, y, "Companies and joint ventures");
    y += 14;
    const gap = 12;
    const cw = (W - gap) / 2;
    for (let i = 0; i < r.companies.length; i += 2) {
      const pair = r.companies.slice(i, i + 2);
      const heights = pair.map((c) => 46 + c.lines.length * 12 + (c.shareholders ? doc.wrap(c.shareholders, cw - 24, 8.5).length * 11 + 4 : 0));
      const h = Math.max(...heights);
      room(h + 10);
      pair.forEach((c, j) => {
        const x = M + j * (cw + gap);
        doc.rect(x, y, cw, h, { fill: "#ffffff", stroke: LINE, lineWidth: 0.8, r: 8 });
        doc.text(x + 12, y + 20, c.name, { size: 11, bold: true, maxWidth: cw - 24 });
        doc.text(x + 12, y + 33, c.kind, { size: 8.5, color: MUTED, maxWidth: cw - 24 });
        let ty = y + 50;
        for (const l of c.lines) { doc.text(x + 12, ty, l, { size: 9.5, maxWidth: cw - 24 }); ty += 12; }
        if (c.shareholders) for (const l of doc.wrap(c.shareholders, cw - 24, 8.5)) { doc.text(x + 12, ty + 2, l, { size: 8.5, color: PINK, bold: true }); ty += 11; }
      });
      y += h + 10;
    }
    y += 16;
  }

  // The list of homes.
  if (r.table && r.table.rows.length) {
    const table = r.table;
    const cols = table.columns;
    const total = cols.reduce((a, c) => a + c.weight, 0);
    const size = cols.length > 7 ? 8 : 9;
    // Start from the weights, then make sure every column fits its heading and
    // (up to a point) its widest value, taking the space from the widest columns.
    const widths = cols.map((c) => (c.weight / total) * W);
    const need = cols.map((c, j) => {
      const head = doc.width(c.label, size - 0.5, true);
      const longest = Math.max(0, ...table.rows.map((row) => doc.width(row[j] ?? "", size, !!c.bold)));
      return Math.max(head, Math.min(longest, 72)) + 12;
    });
    for (let pass = 0; pass < 4; pass++) {
      let deficit = 0;
      widths.forEach((w, j) => { if (w < need[j]) { deficit += need[j] - w; widths[j] = need[j]; } });
      if (deficit <= 0) break;
      const donors = widths.map((w, j) => ({ j, spare: w - need[j] })).filter((d) => d.spare > 0);
      const spare = donors.reduce((a, d) => a + d.spare, 0);
      if (spare <= 0) break;
      for (const d of donors) widths[d.j] -= Math.min(d.spare, (deficit * d.spare) / spare);
    }
    const sum = widths.reduce((a, w) => a + w, 0);
    if (sum > W) widths.forEach((w, j) => { widths[j] = (w * W) / sum; });
    const tableHead = () => {
      doc.rect(M, y, W, 22, { fill: INK, r: 4 });
      let x = M;
      cols.forEach((c, i) => {
        doc.text(c.align === "right" ? x + widths[i] - 6 : x + 6, y + 14.5, c.label, { size: size - 0.5, bold: true, color: "#ffffff", align: c.align, maxWidth: widths[i] - 8 });
        x += widths[i];
      });
      y += 22;
    };
    room(90);
    sectionTitle(doc, M, y, table.title);
    y += 12;
    tableHead();
    table.rows.forEach((row, i) => {
      if (y + 20 > A4.h - FOOT) {
        doc.addPage();
        smallHeader(doc, r);
        y = 70;
        tableHead();
      }
      if (i % 2 === 1) doc.rect(M, y, W, 20, { fill: "#faf7f5" });
      let x = M;
      cols.forEach((c, j) => {
        const val = row[j] ?? "";
        const warn = table.warnWords?.includes(val);
        doc.text(c.align === "right" ? x + widths[j] - 6 : x + 6, y + 13.5, val, {
          size, align: c.align, maxWidth: widths[j] - 10, bold: !!c.bold, color: warn ? "#a4462f" : INK,
        });
        x += widths[j];
      });
      y += 20;
    });
    doc.line(M, y, A4.w - M, y, LINE);
  }

  // Footer on every page.
  const pages = doc.pageCount;
  const foot = [`Prepared by Sphere Property Management on ${r.today}`, r.contact.trim(), "Monthly figures unless stated. Tenant details are not included."]
    .filter(Boolean).join(" · ");
  for (let i = 0; i < pages; i++) {
    doc.onPage(i);
    doc.line(M, A4.h - 34, A4.w - M, A4.h - 34, LINE);
    const lines = doc.wrap(foot, W - 70, 7.5).slice(0, 2);
    lines.forEach((l, j) => doc.text(M, A4.h - 22 + j * 9, l, { size: 7.5, color: MUTED }));
    doc.text(A4.w - M, A4.h - 22, `Page ${i + 1} of ${pages}`, { size: 7.5, bold: true, color: MUTED, align: "right" });
  }
  return doc.toBytes(`Sphere Property Management - ${r.subtitle}`);
}
