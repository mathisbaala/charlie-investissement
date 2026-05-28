"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { Check, AlertTriangle, X } from "@/components/ui/icons";

type ToastTone = "default" | "ok" | "warn";

export interface ToastItem {
  id: string;
  title: string;
  subtitle?: string;
  tone?: ToastTone;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (item: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...item, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastHost />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.toast;
}

function ToastHost() {
  const ctx = useContext(ToastContext)!;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none">
      {ctx.toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => ctx.dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tones: Record<ToastTone, { icon: React.ReactNode; cls: string }> = {
    default: {
      icon: <span className="w-4.5 h-4.5 rounded-full bg-ink flex items-center justify-center flex-shrink-0"><Check size={10} className="text-paper" strokeWidth={2.5} /></span>,
      cls: "border-line",
    },
    ok: {
      icon: <span className="w-4.5 h-4.5 rounded-full bg-ok flex items-center justify-center flex-shrink-0"><Check size={10} className="text-paper" strokeWidth={2.5} /></span>,
      cls: "border-ok/30",
    },
    warn: {
      icon: <span className="w-4.5 h-4.5 rounded-full bg-warn flex items-center justify-center flex-shrink-0"><AlertTriangle size={10} className="text-paper" strokeWidth={2.5} /></span>,
      cls: "border-warn/30",
    },
  };
  const { icon, cls } = tones[item.tone ?? "default"];

  return (
    <div
      className={`c-toast-in pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-xs bg-paper border ${cls} rounded-lg px-3.5 py-3 shadow-[0_4px_16px_oklch(0.22_0.012_60_/_0.12)]`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium text-ink leading-tight">{item.title}</p>
        {item.subtitle && (
          <p className="text-[11px] text-muted mt-0.5 leading-tight">{item.subtitle}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-muted hover:text-ink-2 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
