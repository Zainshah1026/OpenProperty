/**
 * Private CSV endpoint for the portfolio dashboard.
 *
 * Paste into the spreadsheet's Extensions → Apps Script, set KEY to a long
 * random string, then Deploy → New deployment → Web app (Execute as: Me,
 * Who has access: Anyone). Give the dashboard the web app URL as
 * SHEET_SCRIPT_URL and the same KEY as SHEET_SCRIPT_KEY.
 *
 * The sheet itself stays private: this hands out a tab as CSV only to a
 * request that carries the key, and anything else gets "ERROR: forbidden".
 */
const KEY = 'REPLACE_WITH_A_LONG_RANDOM_KEY';

function doPost(e) {
  return respond_(e, e && e.postData ? e.postData.contents : '');
}

function doGet(e) {
  // GETs never carry the key, so they are always refused.
  return respond_(e, '');
}

function respond_(e, key) {
  if (!KEY || KEY.indexOf('REPLACE_') === 0 || key !== KEY) {
    return ContentService.createTextOutput('ERROR: forbidden');
  }
  const gid = Number((e && e.parameter && e.parameter.gid) || NaN);
  const sheet = SpreadsheetApp.getActive().getSheets().filter(function (s) {
    return s.getSheetId() === gid;
  })[0];
  if (!sheet) return ContentService.createTextOutput('ERROR: no tab with gid ' + gid);
  const rows = sheet.getDataRange().getDisplayValues();
  const csv = rows.map(function (row) {
    return row.map(function (cell) {
      const v = String(cell);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',');
  }).join('\n');
  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}
