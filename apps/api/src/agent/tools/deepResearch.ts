import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { logger } from '../../lib/logger.js'
import { getProviderInfo } from '../llm.js'
import { truncateResult } from './retry.js'

const MAX_SUB_QUERIES = 5
const TOTAL_TIMEOUT_MS = 120_000

/** Small dedicated LLM for planner/synthesis (capped output, no tools, no streaming). */
function makeInnerLlm(maxTokens: number, temperature = 0.2): ChatOpenAI {
  const p = getProviderInfo()
  return new ChatOpenAI({
    apiKey: p.apiKey,
    model: p.model,
    temperature,
    maxTokens,
    streaming: false,
    configuration: { baseURL: p.baseURL },
  })
}

/**
 * deep_research(query) — read-only research subagent as a single tool.
 *
 * Phases: plan (decompose into ≤5 sub-queries) → fan-out (parallel searches
 * on whitelisted search tools only) → synthesize (one cited markdown pass).
 *
 * Kill/liveness controls (all code-enforced):
 * - AbortSignal.any([outer client abort, 120s wall clock]) threaded into
 *   planner + synthesis LLM calls — real cancellation, not just stop-waiting
 * - Each search fetch self-terminates at 15s (existing internal timeouts)
 * - Graceful degradation: timeout/cancel with partial results synthesizes
 *   what it has; never throws — always returns a string ToolMessage
 * - Heartbeat `sub-progress` events via Redis pub/sub ({phase, done, total})
 *   → SSE → UI, plus phase-transition pino logs server-side
 * - Per-run query dedup (normalized Set) and result truncation per source
 */
export function createDeepResearchTool(searchTools: StructuredToolInterface[]) {
  return tool(
    async ({ query }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      const outerSignal = config?.signal instanceof AbortSignal ? config.signal : undefined

      const started = Date.now()
      const toSec = (ms: number) => +(ms / 1000).toFixed(2)

      // Combined kill signal: user abort (Stop button / disconnect) OR wall clock
      const timeoutSignal = AbortSignal.timeout(TOTAL_TIMEOUT_MS)
      const killSignal = outerSignal ? AbortSignal.any([outerSignal, timeoutSignal]) : timeoutSignal
      const wasAbortedByUser = () => outerSignal?.aborted ?? false

      const publish = async (phase: string, done: number, total: number) => {
        if (!threadId) return
        try {
          const { publishThreadEvent } = await import('../../lib/pubsub.js')
          await publishThreadEvent(threadId, 'sub-progress', { phase, done, total })
        } catch {
          // progress events are best-effort — never fail research over them
        }
      }

      try {
        // ── Phase 1: Plan (decompose; LLM outputs JSON only) ──
        await publish('planning', 0, 0)
        const planStart = Date.now()
        let subQueries: string[] = []
        try {
          const planner = makeInnerLlm(300, 0)
          const res = await planner.invoke(
            [
              {
                role: 'system',
                content:
                  'Decompose the research question into 3-5 specific, diverse search queries. Respond with ONLY a JSON array of strings, no prose, no code fences. Example: ["query one","query two","query three"]',
              },
              { role: 'user', content: query },
            ],
            { signal: killSignal },
          )
          const text = typeof res.content === 'string' ? res.content : ''
          const jsonText = text.replace(/```(?:json)?/g, '').trim()
          const parsed = z.array(z.string().min(1)).safeParse(JSON.parse(jsonText))
          if (parsed.success) subQueries = parsed.data
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err
          // planner failure → fall back to the original query
        }
        // Dedupe normalized, keep original casing, cap
        const seen = new Set<string>()
        subQueries = subQueries
          .map((q) => q.trim())
          .filter((q) => {
            const k = q.toLowerCase()
            if (!q || seen.has(k)) return false
            seen.add(k)
            return true
          })
          .slice(0, MAX_SUB_QUERIES)
        if (subQueries.length === 0) subQueries = [query]
        logger.info(
          { queries: subQueries, planSec: toSec(Date.now() - planStart) },
          '🔬 deep_research: planned',
        )

        // ── Phase 2: Fan-out (parallel, whitelisted search tools only) ──
        const searchStart = Date.now()
        let done = 0
        const tasks = subQueries.map((q, i) => {
          const t = searchTools[i % searchTools.length]
          if (!t)
            return Promise.resolve({
              q,
              tool: 'unknown',
              ok: false as const,
              text: 'no search tool',
            })
          return t
            .invoke({ query: q })
            .then((r) => {
              done++
              void publish('searching', done, subQueries.length)
              return {
                q,
                tool: t.name,
                ok: true as const,
                text: typeof r === 'string' ? r : JSON.stringify(r),
              }
            })
            .catch((err) => ({
              q,
              tool: t.name,
              ok: false as const,
              text: err instanceof Error ? err.message : String(err),
            }))
        })
        const settled = await Promise.allSettled(tasks)
        const results = settled
          .filter(
            (
              s,
            ): s is PromiseFulfilledResult<{
              q: string
              tool: string
              ok: boolean
              text: string
            }> => s.status === 'fulfilled',
          )
          .map((s) => s.value)
        const okResults = results.filter((r) => r.ok)
        logger.info(
          {
            ok: okResults.length,
            failed: results.length - okResults.length,
            searchSec: toSec(Date.now() - searchStart),
          },
          '🔬 deep_research: searches complete',
        )

        // Aborted with nothing usable → graceful cancel message
        if (killSignal.aborted && okResults.length === 0) {
          return wasAbortedByUser()
            ? 'Research cancelled by user. No results gathered — try asking again.'
            : `Research timed out after ${toSec(TOTAL_TIMEOUT_MS)}s with no usable results. Try a narrower question.`
        }

        // ── Phase 3: Synthesize (single cited pass; honors kill signal) ──
        const context = okResults
          .map((r) => `## Source set: ${r.tool} — query: "${r.q}"\n${truncateResult(r.text, 3000)}`)
          .join('\n\n')

        if (killSignal.aborted) {
          // Aborted mid-run but we have partials — return them without synthesis
          return `Research ${
            wasAbortedByUser() ? 'cancelled' : 'timed out'
          } after ${toSec(Date.now() - started)}s with ${okResults.length}/${subQueries.length} searches complete. Partial findings:\n\n${context.slice(0, 6000)}`
        }

        await publish('synthesizing', okResults.length, subQueries.length)
        const synthStart = Date.now()
        const synthesizer = makeInnerLlm(2048, 0.3)
        const res = await synthesizer.invoke(
          [
            {
              role: 'system',
              content:
                'You are a research synthesizer. Write a concise markdown report (max ~800 words) answering the question using ONLY the provided search results. Cite sources inline as [Tool: query] markers and include a Sources section listing the queries used. If results conflict, note it. Do not invent facts.',
            },
            { role: 'user', content: `Question: ${query}\n\nSearch results:\n\n${context}` },
          ],
          { signal: killSignal },
        )
        const report = typeof res.content === 'string' ? res.content : JSON.stringify(res.content)

        await publish('done', okResults.length, subQueries.length)
        logger.info(
          {
            totalSec: toSec(Date.now() - started),
            synthSec: toSec(Date.now() - synthStart),
            searches: `${okResults.length}/${subQueries.length}`,
          },
          '🔬 deep_research: complete',
        )

        const note =
          okResults.length < subQueries.length
            ? `\n\n*(Note: ${subQueries.length - okResults.length} of ${subQueries.length} searches failed — report may be incomplete.)*`
            : ''
        return `${report}${note}`
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return wasAbortedByUser()
            ? 'Research cancelled by user.'
            : `Research timed out after ${toSec(Date.now() - started)}s. Try a narrower question.`
        }
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg }, '🔬 deep_research: failed')
        return `Research failed: ${msg}`
      }
    },
    {
      name: 'deep_research',
      description:
        'Deep research: decomposes a question into sub-queries, runs parallel web searches, and returns a single synthesized, cited markdown report. Read-only — use for broad, multi-faceted, or comparison questions that need more than one search. Not for simple factual lookups.',
      schema: z.object({
        query: z.string().describe('The research question'),
      }),
    },
  )
}
