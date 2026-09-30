import * as React from "react"
import { cn } from "../../lib/utils"
import { formatAmount } from "../../lib/currency"

type AmountInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | string | null | undefined
  onValueChange: (value: number) => void
}

/** Numeric input that shows "1,234.56" when idle and the raw number while editing. Empty or zero shows the placeholder. */
export function AmountInput({ value, onValueChange, className, onFocus, onBlur, placeholder = "0.00", ...props }: AmountInputProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const numeric = Number(value) || 0

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={editing ? draft : numeric ? formatAmount(numeric) : ""}
      onFocus={e => {
        setDraft(numeric ? String(numeric) : "")
        setEditing(true)
        onFocus?.(e)
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9.\-]/g, "")
        setDraft(raw)
        const parsed = Number(raw)
        onValueChange(Number.isFinite(parsed) ? parsed : 0)
      }}
      onBlur={e => {
        setEditing(false)
        onBlur?.(e)
      }}
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  )
}
