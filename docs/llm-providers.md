# LLM Providers Reference

A living reference of trending LLM providers, their OpenAI-compatible endpoints, and current model IDs. Use this when adding a new provider to `apps/api/src/agent/llm.ts`.

> **Convention:** every provider below is **OpenAI-compatible** unless marked with 🚫 (proprietary API). Providers marked 🚫 need an adapter or an aggregator like OpenRouter to work with our `ChatOpenAI` client.

> **🌐 International-first:** all Chinese providers below list their **international endpoint as primary** (default), with the China-only endpoint noted as an alternative. Set `LLM_BASE_URL` explicitly if you need the China endpoint.

---

## Currently configured

These are wired into `apps/api/src/agent/llm.ts` `PROVIDER_DEFAULTS`:

| Provider | `LLM_PROVIDER` | Base URL (international) | Default model |
|---|---|---|---|
| Zhipu GLM | `glm` | `https://api.z.ai/api/paas/v4` | `glm-5.2` |
| MiniMax | `minimax` | `https://api.minimax.io/v1` | `MiniMax-M3` |
| Xiaomi MiMo | `mimo` | `https://sg.api.mimo.xiaomi.com/v1` (Singapore) ⚠️ verify | `MiMo-2.5-Pro` |
| Custom / bring-your-own | `custom` | `http://localhost:11434/v1` (Ollama) | `gpt-4o-mini` |

---

## Chinese providers — international endpoints (OpenAI-compatible)

| Provider | Base URL (international) | China alternative | Trending models |
|---|---|---|---|
| **Zhipu GLM (智谱)** | `https://api.z.ai/api/paas/v4` | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2`, `glm-4.5`, `glm-4-flash`, `glm-4-long` |
| **MiniMax** | `https://api.minimax.io/v1` | `https://api.minimax.chat/v1` | `MiniMax-M3`, `MiniMax-M1`, `MiniMax-Text-01`, `abab6.5-chat` |
| **Xiaomi MiMo (小米)** | `https://sg.api.mimo.xiaomi.com/v1` ⚠️ verify | (China endpoint TBD) | `MiMo-2.5-Pro`, `MiMo-7B-RL`, `MiMo-7B-Instruct` |
| **DeepSeek (深度求索)** | `https://api.deepseek.com/v1` (global) | same endpoint | `deepseek-chat`, `deepseek-reasoner` (R1) |
| **Moonshot / Kimi (月之暗面)** | `https://api.moonshot.ai/v1` | `https://api.moonshot.cn/v1` | `kimi-k2`, `moonshot-v1-128k`, `moonshot-v1-32k`, `moonshot-v1-8k` |
| **Alibaba Qwen (通义千问)** | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-max`, `qwen-plus`, `qwen-turbo`, `qwen2.5-72b-instruct` |
| **Doubao / Volcengine Ark (豆包)** | `https://ark.volcengineapi.com/api/v3` ⚠️ verify | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-1.5-pro`, `doubao-pro-256k`, `doubao-lite` (use endpoint IDs) |
| **Baichuan (百川)** | `https://api.baichuan-ai.com/v1` | same endpoint | `Baichuan4-Turbo`, `Baichuan3-Turbo` |
| **Yi / Lingyiwanwu (零一万物)** | `https://api.lingyiwanwu.com/v1` | same endpoint | `yi-large`, `yi-lightning`, `yi-medium` |
| **Stepfun (阶跃星辰)** | `https://api.stepfun.com/v1` | same endpoint | `step-2-16k`, `step-1-8k`, `step-1v-32k` |

**Where to get keys:**
| Provider | International portal |
|---|---|
| Zhipu GLM | https://z.ai |
| MiniMax | https://www.minimax.io |
| Xiaomi MiMo | Xiaomi AI portal (Singapore region) |
| DeepSeek | https://platform.deepseek.com |
| Moonshot / Kimi | https://platform.moonshot.ai |
| Alibaba Qwen | https://www.alibabacloud.com (DashScopeIntl) |
| Doubao / Volcengine | https://www.volcengine.com |
| Baichuan | https://platform.baichuan-ai.com |
| Yi / Lingyiwanwu | https://platform.lingyiwanwu.com |
| Stepfun | https://platform.stepfun.com |

### 🚫 Chinese providers with proprietary APIs (need adapter or OpenRouter)

| Provider | Note |
|---|---|
| Baidu ERNIE (文心一言) | proprietary — use `erniebot` SDK or route via OpenRouter |
| iFlytek Spark (讯飞星火) | proprietary WebSocket API |
| Tencent Hunyuan (腾讯混元) | proprietary — has an OpenAI-compatible mode at `https://api.hunyuan.cloud.tencent.com/v1` but only for some models; China-only |
| 360 GPT (360智脑) | proprietary, China-only |

---

## International providers (OpenAI-compatible)

| Provider | Base URL | Trending models | Key from |
|---|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, `o3`, `o3-mini`, `gpt-4-turbo` | https://platform.openai.com |
| **Groq** (fast open-model inference) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768` | https://console.groq.com |
| **Together AI** | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `Qwen/Qwen2.5-72B-Instruct-Turbo` | https://api.together.xyz |
| **Fireworks AI** | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p3-70b-instruct`, `accounts/fireworks/models/qwen2p5-72b-instruct` | https://fireworks.ai |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest`, `mistral-small-latest`, `codestral-latest`, `pixtral-large-latest` | https://console.mistral.ai |
| **xAI Grok** | `https://api.x.ai/v1` | `grok-3`, `grok-3-mini`, `grok-2-vision` | https://console.x.ai |
| **Perplexity** | `https://api.perplexity.ai` | `sonar-pro`, `sonar`, `sonar-reasoning` | https://docs.perplexity.ai |
| **DeepInfra** | `https://api.deepinfra.com/v1/openai` | `meta-llama/Llama-3.3-70B-Instruct`, `deepseek-ai/DeepSeek-R1` | https://deepinfra.com |
| **Cerebras** (fast inference) | `https://api.cerebras.ai/v1` | `llama-3.3-70b`, `llama3.1-8b` | https://cerebras.ai |
| **SambaNova** | `https://api.sambanova.ai/v1` | `Meta-Llama-3.3-70B-Instruct`, `DeepSeek-R1` | https://cloud.sambanova.ai |

### 🚫 International providers with proprietary APIs

| Provider | Note |
|---|---|
| **Anthropic Claude** | proprietary Messages API — use `@langchain/anthropic`, or route via OpenRouter to keep `ChatOpenAI` |
| **Google Gemini** | proprietary — use `@langchain/google-genai`, or OpenRouter |
| **Cohere** | proprietary — has an OpenAI-compatible mode at `https://api.cohere.ai/v1` but only for chat |

---

## Aggregators (one key, many models)

| Provider | Base URL | Note |
|---|---|---|
| **OpenRouter** | `https://openrouter.ai/api/v1` | Routes to 200+ models including Claude, Gemini, GPT, and Chinese models. Best for trying many providers without multiple keys. |
| **SiliconFlow (硅基流动)** | `https://api.siliconflow.cn/v1` | Hosts most open Chinese models (Qwen, DeepSeek, Yi, Baichuan, MiMo) behind one API. Generous free tier. China endpoint. |
| **Novita AI** | `https://api.novita.ai/v3/openai` | Hosts many open models including DeepSeek, Llama, Qwen. International-friendly. |

---

## Self-hosted / local (OpenAI-compatible)

| Runtime | Default base URL | Models |
|---|---|---|
| **Ollama** | `http://localhost:11434/v1` | `llama3.3`, `qwen2.5`, `deepseek-r1`, `mistral` (anything you `ollama pull`) |
| **vLLM** | `http://localhost:8000/v1` | whatever model you launched with `--model` |
| **LM Studio** | `http://localhost:1234/v1` | any model loaded in the GUI |
| **llama.cpp server** | `http://localhost:8080/v1` | the GGUF you started it with |

---

## How to add a new provider

1. Pick a key (e.g. `deepseek`).
2. Add to `LLM_PROVIDERS` tuple in `apps/api/src/agent/llm.ts:3`:
   ```ts
   export const LLM_PROVIDERS = ['glm', 'minimax', 'mimo', 'custom', 'deepseek'] as const
   ```
3. Add to `PROVIDER_DEFAULTS` in `apps/api/src/agent/llm.ts`:
   ```ts
   deepseek: {
     baseURL: 'https://api.deepseek.com/v1',
     model: 'deepseek-chat',
     label: 'DeepSeek (深度求索)',
   },
   ```
4. That's it. Env validation, factory, and docs all pick it up automatically. Set `LLM_PROVIDER=deepseek` in `.env`.

> 💡 **Default to international URLs.** For Chinese providers, prefer the international endpoint (`.io`, `.ai`, `sg.`, `-intl.`) as the default. The China endpoint should be documented as an alternative, not the primary.

---

## Choosing a provider

**For production reliability:**
- International: **OpenAI** (most mature), **Anthropic via OpenRouter** (Claude quality), **Mistral** (EU data residency)
- China-origin (international endpoints): **GLM** (Zhipu via Z.ai), **DeepSeek** (great value), **Qwen** (Alibaba international)

**For cost / experimentation:**
- **SiliconFlow** for open Chinese models (often free tier)
- **Groq** for blazing-fast open-model inference (Llama, DeepSeek)
- **OpenRouter** to A/B many providers behind one key

**For privacy / offline:**
- **Ollama** or **vLLM** self-hosted
- **Together AI** for managed private inference of open weights
