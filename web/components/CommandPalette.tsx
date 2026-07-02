'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CommandItem {
  label: string
  href: string
  group: string
}

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export default function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const results = useMemo(() => {
    const matched = items.filter((i) => fuzzyMatch(query, `${i.group} ${i.label}`))
    return matched.slice(0, 50)
  }, [items, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 sm:pt-32" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="text-zinc-500 font-mono text-sm">&gt;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex((i) => Math.min(i + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const item = results[activeIndex]
                if (item) go(item.href)
              }
            }}
            placeholder="Jump to a route..."
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none font-mono"
          />
          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && <div className="px-4 py-6 text-center text-sm text-zinc-500">No matching routes.</div>}
          {results.map((item, idx) => (
            <button
              key={item.href}
              onClick={() => go(item.href)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                idx === activeIndex ? 'bg-lime-500/10 text-lime-300' : 'text-zinc-300'
              }`}
            >
              <span>{item.label}</span>
              <span className="font-mono text-xs text-zinc-600">{item.href}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
