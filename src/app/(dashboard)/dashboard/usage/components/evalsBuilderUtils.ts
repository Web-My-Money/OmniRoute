export type BuilderStrategy = "contains" | "exact" | "regex";

export interface EvalCaseDraft {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  strategy: BuilderStrategy;
  expectedValue: string;
  tags: string;
}

export interface EvalSuiteDraft {
  id?: string;
  name: string;
  description: string;
  cases: EvalCaseDraft[];
}

export const STRATEGIES = [
  {
    name: "contains",
    labelKey: "evalsStrategyContainsLabel",
    icon: "search",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    descriptionKey: "evalsStrategyContainsDescription",
  },
  {
    name: "exact",
    labelKey: "evalsStrategyExactLabel",
    icon: "check_circle",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    descriptionKey: "evalsStrategyExactDescription",
  },
  {
    name: "regex",
    labelKey: "evalsStrategyRegexLabel",
    icon: "code",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    descriptionKey: "evalsStrategyRegexDescription",
  },
  {
    name: "custom",
    labelKey: "evalsStrategyCustomLabel",
    icon: "tune",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    descriptionKey: "evalsStrategyCustomDescription",
  },
];

export function createDraftId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyCaseDraft(): EvalCaseDraft {
  return {
    id: createDraftId(),
    name: "",
    model: "",
    systemPrompt: "",
    userPrompt: "",
    strategy: "contains",
    expectedValue: "",
    tags: "",
  };
}

export function createEmptySuiteDraft(): EvalSuiteDraft {
  return {
    name: "",
    description: "",
    cases: [createEmptyCaseDraft()],
  };
}
