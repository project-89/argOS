/** Role-based models. Normalize new Gemini parameters centrally. */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { googleProviderFetch } from "./google-transport";

const google = createGoogleGenerativeAI({ fetch: googleProviderFetch });

export const MODEL_IDS = {
  code: process.env.ARGOS_CODE_MODEL || "gemini-3.8-flash",
  flash: process.env.ARGOS_AGENT_MODEL || "gemini-3.8-flash",
  flashLite: process.env.ARGOS_RENDER_MODEL || "gemini-3.8-flash",
};

export const gemini38Middleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const options = params.providerOptions?.google ?? {};
    const thinking = (options.thinkingConfig ?? {}) as Record<string, any>;
    const { thinkingBudget: _budget, ...rest } = thinking;
    return {
      ...params,
      temperature: undefined, topP: undefined, topK: undefined,
      frequencyPenalty: undefined, presencePenalty: undefined,
      providerOptions: {
        ...params.providerOptions,
        google: { ...options, thinkingConfig: { ...rest,
          thinkingLevel: thinking.thinkingLevel === "minimal" ? "low" : (thinking.thinkingLevel ?? "medium"),
        } },
      },
    };
  },
};

export function createArgosModel(id: string) {
  const model = google(id);
  return wrapLanguageModel({ model, middleware: id.startsWith("gemini-3.8-") ? [simulationTaskMiddleware, gemini38Middleware] : simulationTaskMiddleware });
}

export const simulationTaskMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const signal = getSimulationTaskSignal();
    if (!signal) return params;
    signal.throwIfAborted();
    return { ...params, abortSignal: params.abortSignal ? AbortSignal.any([signal, params.abortSignal]) : signal };
  },
  wrapGenerate: async ({ doGenerate }) => {
    const signal = getSimulationTaskSignal();
    signal?.throwIfAborted();
    const result = await doGenerate();
    signal?.throwIfAborted();
    return result;
  },
};

export const codeModel = createArgosModel(MODEL_IDS.code);
export const flashModel = createArgosModel(MODEL_IDS.flash);
export const flashLiteModel = createArgosModel(MODEL_IDS.flashLite);
export const proModel = codeModel;
export const plannerModel = codeModel;
export const executorModel = codeModel;
export const agentModel = flashModel;
export const spiritModel = codeModel;
export const daemonModel = flashModel;
export const renderModel = flashLiteModel;
export const intentModel = flashLiteModel;
export const speechAnalysisModel = flashLiteModel;
export const narrativeModel = codeModel;
export const systemBakerModel = codeModel;
export const defaultModel = codeModel;
export const reasoningModel = codeModel;

export const THINKING_LEVELS = {
  PLANNER: "high", REVIEW: "high", EXECUTOR: "high", AGENT: "low",
  DAEMON: "low", SPIRIT: "medium", RENDER: "low", INTENT: "low",
} as const;

export const MODEL_INFO = {
  code: { name: MODEL_IDS.code, purpose: "Planning, engineering, spirits, review" },
  flash: { name: MODEL_IDS.flash, purpose: "NPC cognition and observation" },
  flashLite: { name: MODEL_IDS.flashLite, purpose: "Rendering, intent and speech analysis" },
};
export function logModelConfig(): void {
  console.log(`[Models] Engineering: ${MODEL_IDS.code}; NPCs: ${MODEL_IDS.flash}; rendering: ${MODEL_IDS.flashLite}`);
}
