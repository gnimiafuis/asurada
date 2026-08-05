import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

type Props = {
  content: string
  className?: string
}

function MarkdownImpl({ content, className }: Props) {
  const rehypePlugins = useMemo(() => [rehypeHighlight], [])
  const remarkPlugins = useMemo(() => [remarkGfm], [])

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none ${className ?? ''}`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-[#0d1117] p-3 text-xs">{children}</pre>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
