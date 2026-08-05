import * as messages from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { createLlm } from './llm.js'
import { buildTools } from './tools/index.js'

export { messages }

/**
 * Build a tool-calling LangGraph agent with checkpointing.
 *
 * The graph loops: agent → (wants tools?) → tools → agent → ... → (no tools?) → END
 * The LLM decides which tool to call based on the query. Each search tool
 * is registered conditionally based on which API keys are set.
 */
export function buildAgent(
  checkpointer: PostgresSaver,
  systemPrompt: string,
  env: { TAVILY_API_KEY?: string; EXA_API_KEY?: string; FIRECRAWL_API_KEY?: string },
) {
  const tools = buildTools(env)
  const model = createLlm().bindTools(tools)

  const callModel = async (state: { messages: BaseMessage[] }) => {
    const response = await model.invoke([
      new messages.SystemMessage(systemPrompt),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')

  return workflow.compile({ checkpointer })
}

export type Agent = ReturnType<typeof buildAgent>
