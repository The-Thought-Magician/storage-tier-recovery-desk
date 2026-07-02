interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-3 text-zinc-400 ${className}`}>
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-lime-400" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export default Spinner
