import { useEffect, useRef, useState } from "react";
import { FileText, Send, Sparkles, X } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  invoices?: { id: number; number: string }[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Who is behind on rent, and by how much?",
  "What goes out this week?",
  "Which certificates expire in the next 2 months?",
  "Draft an invoice to NACCS for this month's rent at 27 Reeves Avenue",
];

/** Light formatting for replies: **bold** and line breaks, nothing else. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className="block min-h-[0.75em]">
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? <b key={j}>{part.slice(2, -2)}</b> : <span key={j}>{part}</span>,
          )}
        </span>
      ))}
    </>
  );
}

/**
 * The "Ask" assistant: a chat panel on every page. It answers from the live
 * portfolio and can draft invoices, which wait on the Invoices page until
 * someone presses Send.
 */
export function AssistantPanel({ navigate }: { navigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ enabled: boolean }>("GET", "/api/assistant").then((d) => setEnabled(d.enabled)).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const history = next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
      const res = await api<{ reply: string; invoices: { id: number; number: string }[] }>("POST", "/api/assistant", { messages: history });
      setMessages([...next, { role: "assistant", content: res.reply, invoices: res.invoices }]);
      if (res.invoices?.length) window.dispatchEvent(new Event("invoices-changed"));
    } catch (err) {
      setMessages([...next, { role: "assistant", content: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03]"
        >
          <Sparkles className="size-4" /> Ask
        </button>
      )}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col border-t bg-card shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[36rem] sm:w-[26rem] sm:rounded-xl sm:border">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Sparkles className="size-4 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Ask about the portfolio</div>
              <div className="text-[11px] text-muted-foreground">Answers from live data. Invoices are drafted, never sent without you.</div>
            </div>
            {messages.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMessages([])}>Clear</button>
            )}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {enabled === false && (
              <p className="rounded-md bg-warning-tint px-3 py-2 text-xs text-warning">
                The assistant isn't switched on yet. Add an ANTHROPIC_API_KEY in Render's environment settings.
              </p>
            )}
            {messages.length === 0 && enabled !== false && (
              <div className="space-y-2">
                <p className="text-muted-foreground">Try:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] rounded-lg px-3 py-2",
                    m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "bg-destructive-tint text-destructive" : "bg-muted",
                  )}
                >
                  <Rich text={m.content} />
                  {m.invoices?.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => { navigate("/invoices"); setOpen(false); }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-xs font-medium text-primary hover:underline"
                    >
                      <FileText className="size-3.5" /> Review draft {inv.number}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {busy && <div className="w-fit rounded-lg bg-muted px-3 py-2 text-muted-foreground">Checking the portfolio…</div>}
          </div>

          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => { e.preventDefault(); ask(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={enabled === false ? "Assistant not set up yet" : "Ask anything about the properties…"}
              disabled={busy || enabled === false}
              className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="submit" disabled={busy || !input.trim() || enabled === false} className="rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50" aria-label="Send question">
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
