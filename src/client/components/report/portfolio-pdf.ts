// The "Share my portfolio" PDF: branded, one or more A4 pages, built in the
// browser so it can be downloaded or sent straight from a phone.

import { A4, PdfDoc } from "../../lib/pdf-writer";

export interface ReportRow { where: string; type: string; beds: string; heldAs: string; status: string; rent: string }
export interface ReportStat { big: string; label: string; color: string }
export interface ReportInput {
  today: string;
  stats: ReportStat[];
  byKind: { label: string; n: number; detail: string }[];
  totalHomes: number;
  hmoNote: string | null;
  areas: { area: string; n: number }[];
  rows: ReportRow[] | null;
  showRent: boolean;
  addresses: boolean;
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

function header(doc: PdfDoc, today: string) {
  doc.rect(0, 0, A4.w, 104, { fill: INK });
  logo(doc, M, 26, 52);
  doc.text(M + 66, 50, "Sphere Property Management", { size: 20, bold: true, color: "#ffffff" });
  doc.text(M + 66, 69, "Property portfolio overview", { size: 11, color: "#ffb3a1" });
  doc.text(A4.w - M, 46, "As at", { size: 9, color: "#cfc6cb", align: "right" });
  doc.text(A4.w - M, 62, today, { size: 11, bold: true, color: "#ffffff", align: "right" });
  doc.rect(0, 104, A4.w / 2, 4, { fill: "#ff7a59" });
  doc.rect(A4.w / 2, 104, A4.w / 2, 4, { fill: "#e6378f" });
}

function smallHeader(doc: PdfDoc, today: string) {
  logo(doc, M, 22, 22);
  doc.text(M + 30, 37, "Sphere Property Management", { size: 10, bold: true });
  doc.text(A4.w - M, 37, `Portfolio overview · ${today}`, { size: 9, color: MUTED, align: "right" });
  doc.line(M, 52, A4.w - M, 52, LINE);
}

function sectionTitle(doc: PdfDoc, y: number, title: string) {
  doc.rect(M, y - 11, 3, 14, { fill: PINK });
  doc.text(M + 10, y, title, { size: 13, bold: true });
}

export function buildPortfolioPdf(r: ReportInput): Uint8Array {
  const doc = new PdfDoc();
  header(doc, r.today);
  let y = 136;

  // Headline figures: four to a row.
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

  // How we hold them (left) and where they are (right).
  const colW = (W - 24) / 2;
  sectionTitle(doc, y, "How we hold them");
  const rightX = M + colW + 24;
  doc.rect(rightX, y - 11, 3, 14, { fill: PINK });
  doc.text(rightX + 10, y, "Where they are", { size: 13, bold: true });
  let ly = y + 22;
  for (const k of r.byKind) {
    const barMax = colW * 0.42;
    const bw = Math.max(10, barMax * (r.totalHomes ? k.n / r.totalHomes : 0));
    doc.rect(M, ly - 8, barMax, 9, { fill: "#f6e6e1", r: 4.5 });
    doc.rect(M, ly - 8, bw, 9, { fill: PINK, r: 4.5 });
    doc.text(M + barMax + 8, ly, `${k.n} ${k.label}`, { size: 9.5, bold: true });
    if (k.detail) doc.text(M + barMax + 8, ly + 11, k.detail, { size: 8.5, color: MUTED });
    ly += k.detail ? 26 : 18;
  }
  if (r.hmoNote) {
    doc.wrap(r.hmoNote, colW, 8.5).forEach((l) => { doc.text(M, ly + 2, l, { size: 8.5, color: MUTED }); ly += 11; });
  }
  // Area chips, wrapping.
  let cx = rightX;
  let cy = y + 14;
  for (const a of r.areas) {
    const label = `${a.area}  ×${a.n}`;
    const w = doc.width(label, 9, true) + 18;
    if (cx + w > rightX + colW) { cx = rightX; cy += 24; }
    doc.rect(cx, cy, w, 18, { fill: TINT, stroke: "#f3d3c8", lineWidth: 0.6, r: 9 });
    doc.text(cx + 9, cy + 12.5, label, { size: 9, bold: true, color: PINK });
    cx += w + 6;
  }
  y = Math.max(ly, cy + 18) + 28;

  // The homes.
  if (r.rows && r.rows.length) {
    const cols = [
      { key: "where", label: r.addresses ? "Address" : "Area", w: r.addresses ? 0.33 : 0.22, align: "left" as const },
      { key: "type", label: "Type", w: r.addresses ? 0.17 : 0.18, align: "left" as const },
      { key: "beds", label: "Beds", w: 0.07, align: "left" as const },
      { key: "heldAs", label: "Held as", w: r.addresses ? 0.15 : 0.2, align: "left" as const },
      { key: "status", label: "Status", w: r.showRent ? 0.12 : 0.33, align: "left" as const },
      ...(r.showRent ? [{ key: "rent", label: "Rent / month", w: 0.16, align: "right" as const }] : []),
    ];
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * W);
    const tableHead = () => {
      doc.rect(M, y, W, 22, { fill: INK, r: 4 });
      let x = M;
      cols.forEach((c, i) => {
        doc.text(c.align === "right" ? x + widths[i] - 8 : x + 8, y + 14.5, c.label, { size: 8.5, bold: true, color: "#ffffff", align: c.align });
        x += widths[i];
      });
      y += 22;
    };
    if (y + 90 > A4.h - FOOT) { doc.addPage(); smallHeader(doc, r.today); y = 76; }
    sectionTitle(doc, y, `The homes (${r.rows.length})`);
    y += 12;
    tableHead();
    r.rows.forEach((row, i) => {
      if (y + 20 > A4.h - FOOT) {
        doc.addPage();
        smallHeader(doc, r.today);
        y = 70;
        tableHead();
      }
      if (i % 2 === 1) doc.rect(M, y, W, 20, { fill: "#faf7f5" });
      let x = M;
      cols.forEach((c, j) => {
        const val = String(row[c.key as keyof ReportRow] ?? "");
        doc.text(c.align === "right" ? x + widths[j] - 8 : x + 8, y + 13.5, val, {
          size: 9, align: c.align, maxWidth: widths[j] - 14, bold: c.key === "rent",
          color: c.key === "status" && val === "Empty" ? "#a4462f" : INK,
        });
        x += widths[j];
      });
      y += 20;
    });
    doc.line(M, y, A4.w - M, y, LINE);
  }

  // Footer on every page.
  const pages = doc.pageCount;
  for (let i = 0; i < pages; i++) {
    doc.onPage(i);
    doc.line(M, A4.h - 34, A4.w - M, A4.h - 34, LINE);
    doc.text(M, A4.h - 20, `Prepared by Sphere Property Management on ${r.today}. Monthly figures unless stated. Tenant details are not included.`, { size: 7.5, color: MUTED, maxWidth: W - 70 });
    doc.text(A4.w - M, A4.h - 20, `Page ${i + 1} of ${pages}`, { size: 7.5, bold: true, color: MUTED, align: "right" });
  }
  return doc.toBytes("Sphere Property Management - portfolio overview");
}
