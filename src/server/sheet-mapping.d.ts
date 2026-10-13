export interface SheetPayload {
  properties: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  rooms: Record<string, unknown>[];
}
export function parseCsv(text: string): Record<string, string>[];
export function buildPayload(csv: { properties?: string; rentToRent?: string; compliance?: string; sales?: string; tenants?: string }): SheetPayload;
