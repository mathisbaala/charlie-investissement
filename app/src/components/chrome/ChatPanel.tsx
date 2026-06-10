"use client";

import { useState, useRef, useEffect } from "react";
import { X, ArrowRight } from "@/components/ui/icons";
import { handledRateLimit } from "@/lib/rateLimitClient";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    if (open && isEmpty) inputRef.current?.focus();
  }, [open, isEmpty]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const updated: Message[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      });

      if (await handledRateLimit(res)) { setStreaming(false); return; }
      if (!res.ok || !res.body) throw new Error("Erreur réseau");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: reply };
          return next;
        });
      }

      if (!reply.trim()) throw new Error("Réponse vide");
    } catch {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const withoutBlank =
          last?.role === "assistant" && last.content === "" ? prev.slice(0, -1) : prev;
        return [...withoutBlank, { role: "assistant", content: "Une erreur s'est produite. Réessayez." }];
      });
    } finally {
      setStreaming(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="c-pop fixed right-2 md:right-4 z-50 w-[360px] max-w-[calc(100vw-1rem)] bg-cream border border-line rounded-xl shadow-[0_12px_40px_oklch(0.22_0.012_60_/_0.18)] flex flex-col overflow-hidden"
      style={{
        top: "62px",
        maxHeight: isEmpty ? "190px" : "520px",
        transition: "max-height 300ms ease",
      }}
    >
      {/* Header — sans séparateur */}
      <div className="flex items-center justify-between px-5 pt-4 pb-1 shrink-0">
        <span
          className="text-[14px] text-ink"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Charlie
        </span>
        <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Messages — aéré, sans boites pour l'assistant */}
      <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2.5 min-h-0">
        {isEmpty ? (
          <p
            className="text-[24px] text-ink leading-tight pt-1"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Bonjour.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "self-end bg-paper rounded-lg px-3 py-1.5 max-w-[85%] text-ink-2"
                  : "self-start text-ink max-w-full"
              }`}
            >
              {m.content}
              {m.role === "assistant" && streaming && i === messages.length - 1 && (
                <span className="inline-block w-1 h-3 bg-accent ml-0.5 animate-pulse" />
              )}
            </div>
          ))
        )}
        {streaming && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-1 items-center text-muted">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-muted-2"
                style={{ animation: `dotBounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — fond paper dans le panel crème, sans border-top */}
      <div className="px-4 pb-4 pt-1 shrink-0">
        <div className="flex items-center gap-2 bg-paper rounded-lg px-3 py-2.5 focus-within:ring-1 focus-within:ring-accent/30 transition-all">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Écrire à Charlie…"
            disabled={streaming}
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted outline-none"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            className="text-muted hover:text-brown disabled:opacity-30 transition-colors"
          >
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
