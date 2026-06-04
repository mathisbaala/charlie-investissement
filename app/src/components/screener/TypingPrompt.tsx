"use client";

import { useState, useRef, useEffect } from "react";

const PROMPTS = [
  "ETF monde éligibles PEA avec faibles frais",
  "Fonds obligataires article 9 peu risqués",
  "SCPI diversifiées avec bon rendement",
  "Actions européennes mid-cap actif",
  "Fonds flexibles multi-actifs SRI ≤ 4",
  "ETF sectoriels technologie américaine",
  "OPCVM Amundi article 8 PER éligibles",
  "Fonds monétaires EUR capital garanti",
];

const TYPING_SPEED   = 40;   // ms/char
const DELETING_SPEED = 20;   // ms/char
const HOLD_DURATION  = 1800; // ms

interface TypingPromptProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  className?: string;
}

export function TypingPrompt({ value, onChange, onSubmit, className = "" }: TypingPromptProps) {
  const [placeholder, setPlaceholder] = useState("");
  const [promptIdx, setPromptIdx]     = useState(0);
  const [phase, setPhase]             = useState<"typing" | "hold" | "deleting">("typing");
  const [charIdx, setCharIdx]         = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const current = PROMPTS[promptIdx];

    if (phase === "typing") {
      if (charIdx < current.length) {
        timerRef.current = setTimeout(() => {
          setPlaceholder(current.slice(0, charIdx + 1));
          setCharIdx((c) => c + 1);
        }, TYPING_SPEED);
      } else {
        timerRef.current = setTimeout(() => setPhase("hold"), HOLD_DURATION);
      }
    } else if (phase === "hold") {
      setPhase("deleting");
    } else {
      if (charIdx > 0) {
        timerRef.current = setTimeout(() => {
          setPlaceholder(current.slice(0, charIdx - 1));
          setCharIdx((c) => c - 1);
        }, DELETING_SPEED);
      } else {
        setPromptIdx((i) => (i + 1) % PROMPTS.length);
        setPhase("typing");
      }
    }

    return () => { if (timerRef.current !== undefined) clearTimeout(timerRef.current); };
  }, [phase, charIdx, promptIdx]);

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value.trim() && onSubmit()}
        className="w-full bg-transparent text-ink text-[14px] outline-none pr-6"
        style={{ fontFamily: "var(--font-serif)", fontStyle: value ? "normal" : "italic" }}
        placeholder=""
        aria-label="Rechercher des fonds"
      />
      {!value && (
        <span
          className="absolute left-0 right-6 top-1/2 -translate-y-1/2 flex items-center whitespace-nowrap overflow-hidden text-muted text-[14px] pointer-events-none select-none"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          {placeholder}
          <span
            className="inline-block w-[2px] h-[1em] bg-accent ml-0.5 relative top-[1px]"
            style={{ animation: "caretBlink 1s steps(2,start) infinite" }}
          />
        </span>
      )}
    </div>
  );
}
