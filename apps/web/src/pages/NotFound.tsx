import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="mb-2 text-4xl font-bold">404</h1>
      <p className="mb-4 text-gray-600">Page not found.</p>
      <Link to="/" className="text-blue-600 underline">
        Go home
      </Link>
    </main>
  )
}
