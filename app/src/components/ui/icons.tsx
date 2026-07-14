// Custom SVG icons + re-exports from lucide-react
export {
  Search, FileText, Download, Upload, X, Plus, RefreshCw,
  SlidersHorizontal, Check, ChevronRight, ChevronDown, ArrowLeft,
  ArrowRight, ArrowDown, ArrowUp, LayoutGrid, AlertTriangle,
  ArrowUpDown, TrendingUp, Shield, Loader2, Target, Wallet, UserCircle, Calculator,
  Clock, RotateCcw
} from "lucide-react";

// Charlie brand logo — uses the official mark PNG
export function Logo({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src="/charlie-logo.png"
      alt="Charlie"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
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
