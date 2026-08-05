import * as messages from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { createLlm } from './llm.js'

export { messages }

/**
 * Build a LangGraph agent with checkpointing.
 *
 * The graph is intentionally simple for v1: a single node that calls the LLM
 * with the full message history. The PostgresSaver ensures every invocation
 * is persisted against the given thread_id, so conversations are resumable.
 *
 * To add tools later, swap `callModel` for a conditional edge that routes
 * between `agent` and `tools` nodes (see LangGraph's ToolNode / prebuilt
 * `createReactAgent`).
 */
export function buildAgent(checkpointer: PostgresSaver, systemPrompt: string) {
  const model = createLlm()

  const callModel = async (state: { messages: BaseMessage[] }) => {
    const response = await model.invoke([
      new messages.SystemMessage(systemPrompt),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addEdge(START, 'agent')
    .addEdge('agent', END)

  return workflow.compile({ checkpointer })
}

export type Agent = ReturnType<typeof buildAgent>
