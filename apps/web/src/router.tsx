import { createBrowserRouter } from 'react-router-dom'
import { ChatLayout } from './pages/ChatLayout.js'
import { EmptyState } from './pages/EmptyState.js'
import { NotFoundPage } from './pages/NotFound.js'
import { ThreadChat } from './pages/ThreadChat.js'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ChatLayout />,
    children: [
      { index: true, element: <EmptyState /> },
      { path: 'threads/:id', element: <ThreadChat /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
