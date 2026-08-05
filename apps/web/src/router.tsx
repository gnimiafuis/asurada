import { createBrowserRouter } from 'react-router-dom'
import { HomePage } from './pages/Home.js'
import { NotFoundPage } from './pages/NotFound.js'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
])
