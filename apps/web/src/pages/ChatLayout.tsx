import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar.js'

export function ChatLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
