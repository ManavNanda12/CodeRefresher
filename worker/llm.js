// llm.js — shared multi-provider LLM engine: Groq + Gemini, with smart model
// routing and automatic fallback. Used by evaluate / hint / followup / rag.
//
// WHY: every provider's free tier caps tokens PER MODEL per day. Hardcoding a
// call to one model (and always *starting* the fallback chain there) drains that
// one quota while the others sit idle. This module:
//   • routes each call to a TIER (small / mid / large) based on task complexity, and
//   • builds a fallback chain that STARTS at that tier, then walks the other
//     models — and finally Gemini — so a single exhausted quota never fails the
//     request, and simple work never touches the 70B quota.
//
// Net effect: simple calls (hints, follow-ups, short answers) ride the cheap
// model; the 70B quota is reserved for genuinely hard answers; and when any one
// model 429s we automatically consume another model's (or provider's) quota.

// ── Groq model tiers, cheapest → strongest. Each has its OWN daily quota. ──
export const GROQ = {
  small: "llama-3.1-8b-instant",    // fast & cheap — short/simple tasks
  mid: "gemma2-9b-it",              // mid complexity
  large: "llama-3.3-70b-versatile", // strongest — complex / code reasoning
};

// Fallback chain per starting tier. Order matters: start at the chosen tier,
// then try the OTHER cheap model before the expensive one, to preserve 70B quota.
const GROQ_CHAINS = {
  small: [GROQ.small, GROQ.mid, GROQ.large],
  mid: [GROQ.mid, GROQ.small, GROQ.large],
  large: [GROQ.large, GROQ.mid, GROQ.small],
};

// Statuses worth noting as "transient/quota" (vs a hard 4xx). We try the next
// provider regardless, but this documents the retryable set.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// Carries the HTTP status from a failed provider call.
export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Heuristic: does this text look like it contains code? Code answers earn 70B. */
export function looksLikeCode(text = "") {
  return /[{};]|=>|\bfunction\b|\bclass\b|\bconst\b|\bimport\b|<\/?[a-z]/.test(text);
}

/**
 * Pick a starting tier from a rough complexity signal.
 * @param {object} opts
 * @param {number}  [opts.length]   total chars of the meaningful input
 * @param {boolean} [opts.hasCode]  input contains code-ish tokens
 * @returns {"small"|"mid"|"large"}
 */
export function chooseTier({ length = 0, hasCode = false } = {}) {
  if (hasCode || length > 2000) return "large";
  if (length > 800) return "mid";
  return "small";
}

// ── Provider definitions ──────────────────────────────────
// Each provider knows how to build its own request and parse its own response.

function groqProvider(model, apiKey, { maxTokens, temperature, json }) {
  return {
    name: `groq/${model}`,
    async call(systemPrompt, userPrompt) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new ProviderError(res.status, `Groq ${model} → ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    },
  };
}

function geminiProvider(model, apiKey, { maxTokens, temperature, json }) {
  return {
    name: `gemini/${model}`,
    async call(systemPrompt, userPrompt) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new ProviderError(res.status, `Gemini ${model} → ${res.status}: ${errBody}`);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    },
  };
}

/**
 * Build the ordered provider chain for a tier, given the keys present in env.
 * Groq models first (ordered by GROQ_CHAINS), Gemini appended as a cross-provider
 * fallback so we extend quota beyond Groq entirely.
 */
function buildChain(env, tier, opts) {
  const providers = [];
  if (env.GROK_API_KEY) {
    for (const model of GROQ_CHAINS[tier] || GROQ_CHAINS.small) {
      providers.push(groqProvider(model, env.GROK_API_KEY, opts));
    }
  }
  if (env.GEMINI_API_KEY) {
    providers.push(geminiProvider("gemini-2.0-flash", env.GEMINI_API_KEY, opts));
  }
  return providers;
}

/**
 * Run a system+user prompt through the fallback chain. Tries each provider in
 * order; on ANY failure moves to the next (a different model/provider may accept
 * the same request). Never throws.
 *
 * @returns {Promise<{ ok: boolean, content: string, model: string|null, errors?: Array }>}
 */
export async function chat(env, {
  system,
  user,
  tier = "small",
  maxTokens = 300,
  temperature = 0.3,
  json = false,
}) {
  const providers = buildChain(env, tier, { maxTokens, temperature, json });
  if (providers.length === 0) {
    return { ok: false, content: "", model: null, errors: [{ message: "No provider API keys configured" }] };
  }

  const errors = [];
  for (const provider of providers) {
    try {
      const content = (await provider.call(system, user)).trim();
      if (content) return { ok: true, content, model: provider.name };
    } catch (err) {
      errors.push({ provider: provider.name, status: err.status || 0, message: err.message });
      // Try the next provider regardless of status — even a hard 4xx on one
      // model may succeed on another. RETRYABLE_STATUSES documents the soft set.
      void RETRYABLE_STATUSES;
    }
  }
  return { ok: false, content: "", model: null, errors };
}
