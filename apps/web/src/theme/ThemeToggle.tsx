import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from './ThemeProvider.js'

const OPTIONS = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'system', icon: Monitor, label: 'System' },
  { value: 'dark', icon: Moon, label: 'Dark' },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5 text-muted-foreground">
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-label={label}
            title={label}
            className={`rounded p-1.5 transition-colors ${
              active ? 'bg-muted text-foreground' : 'hover:text-foreground'
            }`}
          >
            <Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}
