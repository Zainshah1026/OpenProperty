import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Search, Send, Sparkles, X } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { QUICK_QUESTIONS, quickAnswer, searchProperties, type QuickId, type QuickLink } from "./quick-answers";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  invoices?: { id: number; number: string }[];
  links?: QuickLink[];
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
  const app = useApp();
  // No AI key: free quick answers and property search instead of chat.
  const free = enabled === false;

  async function quick(id: QuickId, label: string) {
    if (busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: label }];
    setMessages(next);
    setBusy(true);
    try {
      const a = await quickAnswer(id, app.settings.currency);
      setMessages([...next, { role: "assistant", content: a.text, links: a.links }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function search(text: string) {
    const q = text.trim();
    if (!q) return;
    const a = searchProperties(q, app.properties);
    setMessages([...messages, { role: "user", content: q }, { role: "assistant", content: a.text, links: a.links }]);
    setInput("");
  }

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
          <Sparkles className="size-4" /> {free ? "Quick answers" : "Ask"}
        </button>
      )}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col border-t bg-card shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[36rem] sm:w-[26rem] sm:rounded-xl sm:border">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Sparkles className="size-4 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{free ? "Quick answers" : "Ask about the portfolio"}</div>
              <div className="text-[11px] text-muted-foreground">{free ? "Straight from your live data. Free, nothing leaves the app." : "Answers from live data. Invoices are drafted, never sent without you."}</div>
            </div>
            {messages.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMessages([])}>Clear</button>
            )}
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {free && messages.length === 0 && (
              <p className="text-muted-foreground">Tap a question, or search for a property below.</p>
            )}
            {messages.length === 0 && enabled === true && (
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
                  {m.links?.map((l) => (
                    <button
                      key={l.to + l.label}
                      type="button"
                      onClick={() => { navigate(l.to); setOpen(false); }}
                      className="mt-2 flex items-center gap-1.5 rounded-md bg-card px-2 py-1 text-left text-xs font-medium text-primary hover:underline"
                    >
                      <ArrowRight className="size-3.5 shrink-0" /> {l.label}
                    </button>
                  ))}
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

          {free && (
            <div className="flex gap-1.5 overflow-x-auto border-t px-3 pt-2 pb-1">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q.id} type="button" disabled={busy} onClick={() => quick(q.id, q.label)} className="shrink-0 rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <form
            className={cn("flex gap-2 p-3", !free && "border-t")}
            onSubmit={(e) => { e.preventDefault(); if (free) search(input); else ask(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={free ? "Find a property: ref, address, postcode or tenant" : "Ask anything about the properties…"}
              disabled={busy || enabled === null}
              className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="submit" disabled={busy || !input.trim() || enabled === null} className="rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50" aria-label={free ? "Search" : "Send question"}>
              {free ? <Search className="size-4" /> : <Send className="size-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
