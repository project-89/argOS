/** Jev (TypeSafe's System One model): state plus typed questions in, typed
 * answers with calibrated probabilities out — no generated text. Suited to the
 * many small judgments a living world makes (should this resident look up?
 * is this worth remembering? which of these errands?), at a fraction of a
 * generative call. https://docs.typesafe.ai/api.md
 *
 * Thin HTTP client: POST https://api.typesafe.ai/v1/systemone, bearer key
 * from TYPESAFE_API_KEY (server-side only), retries 429/529 with backoff. */

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };
export type JevAnswer = { type: "noul" | "choice" | "score"; noul?: number; choice?: string; probabilities?: Record<string, number>;
  score?: number; legend?: Record<string, string>; confidence?: number };
export type JevResponse = { model: string; answers: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number } };
export type JevStats = { calls: number; questions: number; failures: number; inputTokens: number; outputTokens: number };

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export class JevClient {
  readonly stats: JevStats = { calls: 0, questions: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { apiKey: string; model?: string; timeoutMs?: number; fetch?: typeof fetch; retries?: number }) {
    this.fetcher = options.fetch ?? fetch;
  }
  /** A client when TYPESAFE_API_KEY is configured, else undefined. */
  static fromEnv(env: Record<string, string | undefined> = process.env): JevClient | undefined {
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    return apiKey ? new JevClient({ apiKey, model: env.TYPESAFE_MODEL?.trim() || undefined }) : undefined;
  }

  /** Ask several questions over one state in a single call (fan-out). */
  async ask(state: unknown, questions: Record<string, JevQuestion>, signal?: AbortSignal): Promise<JevResponse> {
    const body = JSON.stringify({ state, model: this.options.model ?? "jev-latest", questions });
    const retries = this.options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 5000);
      const response = await this.fetcher(JEV_ENDPOINT, { method: "POST", body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}` } });
      if ((response.status === 429 || response.status === 529) && attempt < retries) {
        await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
        continue;
      }
      this.stats.calls++; this.stats.questions += Object.keys(questions).length;
      if (!response.ok) { this.stats.failures++; throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 200)}`); }
      const json = await response.json() as JevResponse;
      this.stats.inputTokens += json.usage?.input_tokens ?? 0; this.stats.outputTokens += json.usage?.output_tokens ?? 0;
      return json;
    }
  }
}
