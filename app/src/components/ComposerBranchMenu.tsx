import { useEffect, useMemo, useState } from 'react'
import { Input, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { Check, ChevronDown, GitBranch, Plus } from 'lucide-react'
import {
  canCreateGitBranch,
  filterGitBranches,
  resolveGitBranchSubmit,
} from '@/lib/composerBranchMenu'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

export default function ComposerBranchMenu({
  branch,
  branches,
  disabled,
  onCheckout,
  onCreate,
}: {
  branch?: string
  branches: readonly string[]
  disabled?: boolean
  onCheckout?: (name: string) => void
  onCreate?: (name: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = branch?.trim() ?? ''
  const matches = useMemo(() => filterGitBranches(branches, query), [branches, query])
  const createName = query.trim()
  const showCreate = canCreateGitBranch(branches, query)
  const emptyLabel = t('选择分支', 'Choose a branch')
  const triggerLabel = current || t('分支', 'Branch')

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  function finish(next: { action: 'checkout' | 'create'; branch: string } | null) {
    if (!next) return
    if (next.action === 'create') onCreate?.(next.branch)
    else onCheckout?.(next.branch)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="chat-composer__chip"
          disabled={disabled}
          aria-label={t(`当前分支：${current || emptyLabel}`, `Current branch: ${current || emptyLabel}`)}
          title={current || emptyLabel}
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="chat-composer__chip__label">{triggerLabel}</span>
          <ChevronDown className="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[18rem] overflow-hidden border-border bg-popover p-0 text-popover-foreground"
      >
        <div className="border-b border-border p-2">
          <Input
            value={query}
            autoFocus
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              finish(resolveGitBranchSubmit(branches, current, query))
            }}
            className="h-8"
            placeholder={t('搜索分支', 'Search branches')}
            aria-label={t('搜索分支', 'Search branches')}
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {matches.map(name => (
            <button
              key={name}
              type="button"
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                name === current ? 'bg-accent' : 'hover:bg-accent',
              )}
              onClick={() => finish(name === current ? null : { action: 'checkout', branch: name })}
            >
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {name === current ? <Check className="size-3.5 shrink-0" /> : null}
            </button>
          ))}
        </div>
        {showCreate ? (
          <div className="border-t border-border p-1">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
              aria-label={t(`创建分支 ${createName}`, `Create branch ${createName}`)}
              onClick={() => finish({ action: 'create', branch: createName })}
            >
              <Plus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('创建分支', 'Create Branch')}</span>
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
