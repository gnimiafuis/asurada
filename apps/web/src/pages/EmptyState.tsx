import { MessageSquare } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquare size={22} />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-medium">Select a thread</h2>
        <p className="text-sm text-muted-foreground">
          Pick a conversation from the sidebar, or start a new one.
        </p>
      </div>
    </div>
  )
}
