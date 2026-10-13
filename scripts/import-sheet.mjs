#!/usr/bin/env node
// Import a portfolio spreadsheet into the app.
//
// Export each tab of the spreadsheet as CSV (File → Download → .csv), then:
//
//   node scripts/import-sheet.mjs --properties Properties.csv \
//        [--compliance Compliance.csv] [--sales Sales.csv] \
//        [--url https://your-app.onrender.com] [--replace] [--out payload.json]
//
// With --url it POSTs to /api/import, logging in with APP_USERNAME (default
// "admin") and APP_PASSWORD from the environment. Without --url it writes the
// payload to --out (or stdout) so you can inspect it first.
//
// Keep the CSVs and payload out of git: they hold tenant and lead details.
// The `private/` folder is ignored for exactly this.

import { readFileSync, writeFileSync } from "node:fs";

// ── Arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

if (!opt("properties") && !opt("sales")) {
  console.error("Usage: import-sheet.mjs --properties Properties.csv [--compliance Compliance.csv] [--sales Sales.csv] [--url URL] [--replace] [--out file]");
  process.exit(1);
}

import { buildPayload } from "../src/server/sheet-mapping.js";

// ── Build ──────────────────────────────────────────────────────────

const read = (file) => (file ? readFileSync(file, "utf8") : "");

const { properties, leads } = buildPayload({
  properties: read(opt("properties")),
  compliance: read(opt("compliance")),
  sales: read(opt("sales")),
});

const payload = { replace: flag("replace"), properties, leads };
console.error(`Prepared ${properties.length} properties and ${leads.length} leads.`);

const url = opt("url");
if (url) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    console.error("Set APP_PASSWORD in the environment to log in.");
    process.exit(1);
  }
  const auth = Buffer.from(`${process.env.APP_USERNAME || "admin"}:${password}`).toString("base64");
  const res = await fetch(new URL("/api/import", url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload),
  });
  console.error(res.status, await res.text());
  if (!res.ok) process.exit(1);
} else if (opt("out")) {
  writeFileSync(opt("out"), JSON.stringify(payload, null, 2));
  console.error(`Wrote ${opt("out")}`);
} else {
  process.stdout.write(JSON.stringify(payload, null, 2));
}
