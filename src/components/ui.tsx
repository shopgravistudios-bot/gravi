import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Locker">
      <defs>
        <linearGradient id="lk-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7aa2ff" />
          <stop offset="1" stopColor="#7b5cff" />
        </linearGradient>
        <radialGradient id="lk-h" cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lk-g)" />
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lk-h)" />
      {/* Keyhole: the "safe" slot of the locker */}
      <circle cx="32" cy="27" r="8" fill="#0a0a0c" />
      <path d="M28 31 L36 31 L38.5 45 Q32 47.5 25.5 45 Z" fill="#0a0a0c" />
    </svg>
  );
}

export function SdCard({ className = "", glow = false }: { className?: string; glow?: boolean }) {
  return (
    <svg viewBox="0 0 48 60" className={className} aria-hidden>
      <path
        d="M10 2h22l14 14v36a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6Z"
        fill="#1f1f26"
        stroke={glow ? "var(--color-accent)" : "rgb(255 255 255 / 0.16)"}
        strokeWidth="1.5"
      />
      {[14, 20, 26, 32].map((x) => (
        <rect key={x} x={x - 1.5} y="7" width="3" height="10" rx="1.2" fill="#d4b76a" opacity="0.9" />
      ))}
      <rect x="10" y="34" width="28" height="16" rx="3" fill="rgb(255 255 255 / 0.06)" />
    </svg>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "safe" | "danger";
  icon?: ReactNode;
};

export function Button({ variant = "primary", icon, className = "", children, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-ink text-bg hover:bg-white shadow-[0_8px_30px_-8px_rgb(255_255_255/0.35)]",
    safe: "bg-safe text-[#04210d] hover:brightness-110 shadow-[0_8px_30px_-8px_rgb(48_209_88/0.6)]",
    ghost: "bg-white/[0.05] text-ink hover:bg-white/[0.09] border border-line",
    danger: "bg-transparent text-muted hover:text-danger",
  }[variant];
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
      {...(rest as object)}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function Field({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <input
        className="h-11 w-full rounded-xl border border-line bg-white/[0.03] px-3.5 text-[15px] text-ink outline-none transition placeholder:text-faint focus:border-accent/70 focus:bg-white/[0.05] focus:ring-4 focus:ring-accent/15"
        {...rest}
      />
    </label>
  );
}

/** Number that counts up/down smoothly to the target value. */
export function Counter({ value, className = "" }: { value: number; className?: string }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 140, damping: 22 });
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString("de-DE"));
  useEffect(() => mv.set(value), [mv, value]);
  return <motion.span className={`tnum ${className}`}>{text}</motion.span>;
}

/** Folder preview: each path segment as an indented row. */
export function FolderTree({ library, segments }: { library: string; segments: string[] }) {
  const root = library.split(/[\\/]/).filter(Boolean).pop() ?? library;
  const rows = [root, ...segments];
  return (
    <div className="rounded-xl border border-line bg-black/30 px-3.5 py-3 font-mono text-[12.5px] leading-[1.9]">
      {rows.map((name, i) => (
        <motion.div
          key={`${i}-${name}`}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center gap-2 truncate"
          style={{ paddingLeft: i * 14 }}
        >
          <svg width="14" height="12" viewBox="0 0 14 12" className="shrink-0">
            <path
              d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3l1.5 1.5h4.5A1.5 1.5 0 0 1 13 4v5.5A1.5 1.5 0 0 1 11.5 11h-9A1.5 1.5 0 0 1 1 9.5Z"
              fill={i === rows.length - 1 ? "var(--color-accent)" : "rgb(255 255 255 / 0.22)"}
            />
          </svg>
          <span className={i === rows.length - 1 ? "text-ink" : "text-muted"}>{name}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** Large green check that draws itself. */
export function BigCheck() {
  return (
    <div className="relative grid place-items-center">
      <motion.div
        className="absolute h-36 w-36 rounded-full bg-safe/25 blur-2xl"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      <motion.svg
        width="112"
        height="112"
        viewBox="0 0 112 112"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
      >
        <circle cx="56" cy="56" r="52" fill="var(--color-safe)" />
        <circle cx="56" cy="56" r="52" fill="url(#ck-h)" />
        <defs>
          <radialGradient id="ck-h" cx="0.3" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#fff" stopOpacity="0.4" />
            <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <motion.path
          d="M34 57 L49 72 L79 41"
          fill="none"
          stroke="#04210d"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.25, duration: 0.45, ease: "easeOut" }}
        />
      </motion.svg>
    </div>
  );
}
