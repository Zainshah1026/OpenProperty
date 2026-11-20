import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/** "07700 900123" → "447700900123"; null when it can't be a WhatsApp number (UK landlines, junk). */
export function whatsappNumber(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("07") && d.length === 11) d = `44${d.slice(1)}`;
  else if (!plus && d.startsWith("0")) return null; // UK landline
  if (d.startsWith("44") && !d.startsWith("447")) return null; // UK landline in international form
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/**
 * Big, thumb-sized Call and WhatsApp buttons for a phone number. `size="sm"`
 * for table rows. Clicks don't open the row underneath.
 */
export function ContactButtons({ phone, message, size = "md", className }: { phone?: string | null; message?: string; size?: "sm" | "md"; className?: string }) {
  if (!phone?.trim()) return null;
  const wa = whatsappNumber(phone);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const base = size === "sm"
    ? "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold"
    : "inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-semibold";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={stop} className={cn(base, "bg-[var(--door-blue)] text-white hover:brightness-110")} aria-label={`Call ${phone}`} title={phone}>
        <Phone className={size === "sm" ? "size-3.5" : "size-4"} /> Call
      </a>
      {wa && (
        <a
          href={`https://wa.me/${wa}${message ? `?text=${encodeURIComponent(message)}` : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className={cn(base, "bg-[#1fa855] text-white hover:brightness-110")}
          aria-label={`WhatsApp ${phone}`}
        >
          <MessageCircle className={size === "sm" ? "size-3.5" : "size-4"} /> WhatsApp
        </a>
      )}
    </span>
  );
}
