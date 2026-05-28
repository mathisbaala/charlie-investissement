"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, ArrowRight } from "@/components/ui/icons";

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
      className={`c-pop fixed right-4 bottom-4 z-50 w-[360px] bg-paper border border-line rounded-xl shadow-[0_8px_24px_oklch(0.22_0.012_60_/_0.14)] flex flex-col overflow-hidden`}
      style={{ maxHeight: isEmpty ? "220px" : "520px", transition: "max-height 300ms ease" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 border-b border-line shrink-0">
        <span
          className="text-[13px] text-ink"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Charlie
        </span>
        <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
        {isEmpty ? (
          <p
            className="text-[22px] text-ink leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Bonjour.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`text-[12.5px] leading-relaxed ${
                m.role === "user"
                  ? "text-ink-2 self-end bg-paper-2 rounded-lg px-3 py-2 max-w-[85%]"
                  : "text-ink self-start max-w-full"
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

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-line shrink-0">
        <div className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 focus-within:border-accent/50 transition-colors">
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
