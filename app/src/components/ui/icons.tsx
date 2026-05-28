// Custom SVG icons + re-exports from lucide-react
export {
  Search, Sparkles, Star, FileText, Download, Upload,
  ArrowLeftRight, X, Plus, RefreshCw, SlidersHorizontal,
  Check, ChevronRight, ChevronDown, ArrowLeft, ArrowRight,
  ArrowDown, LayoutGrid, AlertTriangle, Paperclip, Minus,
  ArrowUpDown, Settings, Menu, ExternalLink, Copy, Trash2,
  Filter, BarChart2, TrendingUp, Shield, Loader2
} from "lucide-react";

// Charlie brand logo: 26×26 ink square with italic Instrument Serif "C"
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="26" height="26" rx="6" fill="oklch(0.22 0.012 60)" />
      <text
        x="13"
        y="19"
        textAnchor="middle"
        fontFamily="'Instrument Serif', Georgia, serif"
        fontStyle="italic"
        fontSize="17"
        fill="oklch(0.955 0.018 78)"
      >
        C
      </text>
    </svg>
  );
}

// Sparkle ✦ brand icon
export function Sparkle({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8 1 L9 6.5 L14.5 8 L9 9.5 L8 15 L7 9.5 L1.5 8 L7 6.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Bot icon for Charlie chat
export function Bot({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="9.5" r="1" fill="currentColor" />
      <path d="M6 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 5V2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="1.5" r="1" fill="currentColor" />
    </svg>
  );
}
