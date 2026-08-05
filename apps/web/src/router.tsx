import { createBrowserRouter } from 'react-router-dom'
import { HomePage } from './pages/Home.js'
import { NotFoundPage } from './pages/NotFound.js'
import { ThreadChatPage } from './pages/ThreadChat.js'
import { ThreadsPage } from './pages/Threads.js'

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/threads', element: <ThreadsPage /> },
  { path: '/threads/:id', element: <ThreadChatPage /> },
  { path: '*', element: <NotFoundPage /> },
])
