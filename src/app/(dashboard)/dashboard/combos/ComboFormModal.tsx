"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Modal from "@/shared/components/Modal";
import Toggle from "@/shared/components/Toggle";
import Tooltip from "@/shared/components/Tooltip";
import { FieldLabelWithHelp, WeightTotalBar } from "./parts";
import { ResponseValidationEditor, type ResponseValidationValue } from "./ResponseValidationEditor";
import ReasoningTokenBufferToggle from "./ReasoningTokenBufferToggle";
import BuilderIntelligentStep from "./BuilderIntelligentStep";
import { pickDisplayValue } from "@/shared/utils/maskEmail";
import useEmailPrivacyStore from "@/store/emailPrivacyStore";
import { useNotificationStore } from "@/store/notificationStore";
import {
  COMBO_BUILDER_AUTO_CONNECTION,
  COMBO_BUILDER_STAGES,
  buildManualComboModelStep,
  buildPrecisionComboModelStep,
  canAccessComboBuilderStage,
  computeBatchAddModelSteps,
  computeBatchDeselectModelSteps,
  findNextSuggestedConnectionId,
  getComboBuilderStageChecks,
  getComboBuilderStages,
  getNextComboBuilderStage,
  getPreviousComboBuilderStage,
  hasExactModelStepDuplicate,
  isIntelligentBuilderStrategy,
  parseQualifiedModel,
  resolveComboBuilderProviderId,
  type ComboBuilderStage,
} from "@/lib/combos/builderDraft";
import { normalizeComboConfigMode } from "@/shared/constants/comboConfigMode";
import { normalizeIntelligentRoutingConfig } from "@/lib/combos/intelligentRouting";
import { useTranslations } from "next-intl";
import {
  COMBO_TEMPLATE_FALLBACK,
  MS_PER_SECOND,
  STRATEGY_OPTIONS,
  deriveCandidatePoolFromModels,
  findProviderNodeByIdentifier,
  formatComboEntryDisplay,
  getI18nOrFallback,
  getModelString,
  getStrategyDescription,
  getStrategyLabel,
  normalizeModelEntry,
  sanitizeComboRuntimeConfig,
} from "./comboFormUtils";

const ModelSelectModal = dynamic(() => import("@/shared/components/ModelSelectModal"), {
  ssr: false,
});

const VALID_NAME_REGEX = /^[a-zA-Z0-9_/.\-\[\] ]+$/;

const ADVANCED_FIELD_HELP_FALLBACK = {
  maxRetries: "How many retries are attempted before failing the request.",
  retryDelay: "Initial delay between retries. Higher values reduce burst pressure.",
  concurrencyPerModel:
    "Round-robin combo/model limit: max simultaneous requests sent to each model target. This is separate from any provider account-only cap.",
  queueTimeout:
    "How long a request can wait for a round-robin model slot before timing out. This queue is separate from any account-only concurrency cap.",
  stickyLimit:
    "Round-robin sticky batch size: consecutive successful requests sent to one target before rotating to the next. Empty inherits the global Sticky Limit setting; 1 disables batching (pure one-request rotation).",
  stickyWeightedLimit:
    "Weighted sticky batch size: consecutive successful requests sent to the selected weighted target before drawing again. Empty or 1 keeps the current per-request weighted draw.",
  failoverBeforeRetry:
    "When enabled, a 429 from the upstream triggers immediate target failover instead of retrying the same URL first.",
  targetTimeoutMs:
    "Optional combo target timeout. Empty inherits the current request timeout; larger values are capped to that timeout.",
  maxSetRetries:
    "Number of times to retry the full target set when every target fails. 0 = no set-level retry.",
  setRetryDelayMs:
    "Delay between set-level retry attempts, giving transient issues time to resolve.",
  nestedComboMode:
    "How references to other combos are handled. Flatten expands a combo ref into this combo's target list (legacy). Execute treats a combo ref as a black-box target: the parent strategy selects the child combo, then the child runs its own strategy and retries.",
};

function msToOptionalSecondsInput(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return String(Math.round(ms / MS_PER_SECOND));
}

function secondsInputToOptionalMs(value, maxSeconds = 86400) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(maxSeconds, Math.round(seconds)) * MS_PER_SECOND;
}

function toInputValue(value: unknown): string | number {
  return typeof value === "number" ? value : value == null ? "" : String(value);
}

function updateFusionTuning(config, field, rawValue) {
  const value = rawValue === "" ? undefined : Number(rawValue);
  const next = { ...(config.fusionTuning || {}), [field]: value };
  const pruned = Object.fromEntries(
    Object.entries(next).filter(([, v]) => typeof v === "number" && Number.isFinite(v))
  );
  return { ...config, fusionTuning: Object.keys(pruned).length > 0 ? pruned : undefined };
}

const COMBO_FORM_STAGE_META = [
  {
    id: "basics",
    fallbackLabel: "Basics",
    fallbackDescription: "Name and starting template.",
    icon: "looks_one",
  },
  {
    id: "steps",
    fallbackLabel: "Steps",
    fallbackDescription: "Provider, model and account selection.",
    icon: "looks_two",
  },
  {
    id: "strategy",
    fallbackLabel: "Strategy",
    fallbackDescription: "Routing behavior and advanced settings.",
    icon: "looks_3",
  },
  {
    id: "intelligent",
    fallbackLabel: "Intelligent",
    fallbackDescription: "Auto-routing candidate pool, presets and scoring.",
    icon: "auto_awesome",
  },
  {
    id: "review",
    fallbackLabel: "Review",
    fallbackDescription: "Final verification before saving.",
    icon: "fact_check",
  },
] satisfies {
  id: ComboBuilderStage;
  fallbackLabel: string;
  fallbackDescription: string;
  icon: string;
}[];

const COMBO_TEMPLATES = [
  {
    id: "free-stack",
    icon: "volunteer_activism",
    titleKey: "templateFreeStack",
    descKey: "templateFreeStackDesc",
    fallbackTitle: COMBO_TEMPLATE_FALLBACK.freeStackTitle,
    fallbackDesc: COMBO_TEMPLATE_FALLBACK.freeStackDesc,
    strategy: "round-robin",
    suggestedName: "free-stack",
    isFeatured: true,
    config: {
      maxRetries: 3,
      retryDelayMs: 500,
    },
  },
  {
    id: "high-availability",
    icon: "shield",
    titleKey: "templateHighAvailability",
    descKey: "templateHighAvailabilityDesc",
    fallbackTitle: COMBO_TEMPLATE_FALLBACK.highAvailabilityTitle,
    fallbackDesc: COMBO_TEMPLATE_FALLBACK.highAvailabilityDesc,
    strategy: "priority",
    suggestedName: "high-availability",
    config: {
      maxRetries: 2,
      retryDelayMs: 1500,
    },
  },
  {
    id: "cost-saver",
    icon: "savings",
    titleKey: "templateCostSaver",
    descKey: "templateCostSaverDesc",
    fallbackTitle: COMBO_TEMPLATE_FALLBACK.costSaverTitle,
    fallbackDesc: COMBO_TEMPLATE_FALLBACK.costSaverDesc,
    strategy: "cost-optimized",
    suggestedName: "cost-saver",
    config: {
      maxRetries: 1,
      retryDelayMs: 500,
    },
  },
  {
    id: "balanced",
    icon: "balance",
    titleKey: "templateBalanced",
    descKey: "templateBalancedDesc",
    fallbackTitle: COMBO_TEMPLATE_FALLBACK.balancedTitle,
    fallbackDesc: COMBO_TEMPLATE_FALLBACK.balancedDesc,
    strategy: "least-used",
    suggestedName: "balanced-load",
    config: {
      maxRetries: 1,
      retryDelayMs: 1000,
    },
  },
  {
    id: "paid-premium",
    icon: "workspace_premium",
    titleKey: "templatePaidPremium",
    descKey: "templatePaidPremiumDesc",
    fallbackTitle: COMBO_TEMPLATE_FALLBACK.paidPremiumTitle,
    fallbackDesc: COMBO_TEMPLATE_FALLBACK.paidPremiumDesc,
    strategy: "round-robin",
    suggestedName: "paid-premium",
    config: {
      maxRetries: 2,
      retryDelayMs: 1000,
    },
  },
];

const STRATEGY_GUIDANCE_FALLBACK = {
  priority: {
    when: "Use when you have one preferred model and only want fallback on failure.",
    avoid: "Avoid when you need balanced load between models.",
    example: "Example: Primary coding model with cheaper backup for outages.",
  },
  weighted: {
    when: "Use when you need controlled traffic split across models.",
    avoid: "Avoid when weights are not maintained or you need strict fairness.",
    example: "Example: 80% stable model and 20% canary model for safe rollout.",
  },
  "round-robin": {
    when: "Use when you need predictable, even request distribution.",
    avoid: "Avoid when model latency/cost differs significantly.",
    example: "Example: Same model across multiple accounts to spread throughput.",
  },
  "context-relay": {
    when: "Use when long sessions must survive account rotation without losing the working context.",
    avoid:
      "Avoid when account switching is rare or when you do not want extra summarization requests.",
    example: "Example: Codex sessions that rotate across multiple accounts near quota exhaustion.",
  },
  random: {
    when: "Use when you want a simple spread with low configuration effort.",
    avoid: "Avoid when requests must be distributed with strict guarantees.",
    example: "Example: Prototyping with equivalent models and no traffic policy.",
  },
  "least-used": {
    when: "Use when you want adaptive balancing based on recent demand.",
    avoid: "Avoid when your traffic is too low to benefit from usage balancing.",
    example: "Example: Mixed workloads where one model tends to get overloaded.",
  },
  "cost-optimized": {
    when: "Use when minimizing cost is the top priority.",
    avoid: "Avoid when pricing data is missing or outdated.",
    example: "Example: Batch or background jobs where lower cost matters most.",
  },
  "reset-aware": {
    when: "Use when multiple accounts with quota telemetry have different reset windows.",
    avoid: "Avoid when quota telemetry is unavailable for most accounts.",
    example: "Example: Prefer a 60% weekly account resetting tomorrow over 80% that resets later.",
  },
  "fill-first": {
    when: "Use when you want to drain one provider's quota fully before moving to the next.",
    avoid: "Avoid when you need request-level load balancing across providers.",
    example: "Example: Use all $200 Deepgram credits before falling to Groq.",
  },
  p2c: {
    when: "Use when you want low-latency selection using Power-of-Two-Choices algorithm.",
    avoid: "Avoid for small combos with 2 or fewer models — no benefit over round-robin.",
    example: "Example: High-throughput inference across 4+ equivalent model endpoints.",
  },
  "strict-random": {
    when: "Use when you want perfectly even spread — each model used once before repeating.",
    avoid: "Avoid when models have different quality or latency and order matters.",
    example: "Example: Multiple accounts of the same model to distribute usage evenly.",
  },
  auto: {
    when: "Use when you want multi-factor scoring based on cost, latency, and quality.",
    avoid: "Avoid when you need strict priority ordering or historical persistence.",
    example: "Example: Balance requests between models with different strengths.",
  },
  lkgp: {
    when: "Use when you want routing based on historical success rates and performance.",
    avoid: "Avoid when historical data is limited or unreliable.",
    example: "Example: Route to models with proven track records for specific tasks.",
  },
  "context-optimized": {
    when: "Use when you need to optimize for context window usage across models.",
    avoid: "Avoid when models have similar context lengths or simple tasks.",
    example: "Example: Distribute long conversations across models with large context windows.",
  },
};

const STRATEGY_RECOMMENDATIONS_FALLBACK = {
  priority: {
    title: "Fail-safe baseline",
    description: "Use one primary model and keep fallback chain short and reliable.",
    tips: [
      "Put your most reliable model first.",
      "Keep 1-2 backup models with similar quality.",
      "Use safe retries to absorb transient provider failures.",
    ],
  },
  weighted: {
    title: "Controlled traffic split",
    description: "Great for canary rollouts and gradual migration between models.",
    tips: [
      "Start with conservative split like 90/10.",
      "Keep the total at 100% and auto-balance after changes.",
      "Monitor success and latency before increasing canary weight.",
    ],
  },
  "round-robin": {
    title: "Predictable load sharing",
    description: "Best when models are equivalent and you need smooth distribution.",
    tips: [
      "Use at least 2 models.",
      "Set concurrency limits to avoid burst overload.",
      "Use queue timeout to fail fast under saturation.",
    ],
  },
  "context-relay": {
    title: "Session continuity first",
    description:
      "Best when account rotation is expected and the next account must inherit a condensed task summary.",
    tips: [
      "Use with providers that rotate accounts for the same model family.",
      "Keep the handoff threshold below the hard quota cutoff to give the summary time to generate.",
      "Set a dedicated summary model only when the primary model is too expensive or unstable.",
    ],
  },
  random: {
    title: "Quick spread with low setup",
    description: "Use when you need simple distribution without strict guarantees.",
    tips: [
      "Use models with similar latency profiles.",
      "Keep retries enabled to absorb random misses.",
      "Prefer this for experimentation, not strict SLAs.",
    ],
  },
  "least-used": {
    title: "Adaptive balancing",
    description: "Routes to less-used models to reduce hotspots over time.",
    tips: [
      "Works better under continuous traffic.",
      "Combine with health checks for safer balancing.",
      "Track per-model usage to validate distribution gains.",
    ],
  },
  "cost-optimized": {
    title: "Budget-first routing",
    description: "Routes to lower-cost models when pricing metadata is available.",
    tips: [
      "Ensure pricing coverage for all selected models.",
      "Keep a quality fallback for hard prompts.",
      "Use for batch/background jobs where cost is the main KPI.",
    ],
  },
  "reset-aware": {
    title: "Reset-aware account rotation",
    description: "Balances remaining provider quota against reset timing.",
    tips: [
      "Use explicit account steps or account-tag routing for providers with quota telemetry.",
      "Tune session vs weekly weights when short-term exhaustion is more risky.",
      "Keep the tie band small so equivalent accounts still rotate fairly.",
    ],
  },
  "fill-first": {
    title: "Quota drain strategy",
    description: "Exhausts one provider's quota before moving to the next in chain.",
    tips: [
      "Order models by free quota size — biggest first.",
      "Enable health checks to skip drained providers.",
      "Ideal for free-tier stacking (Deepgram → Groq → NIM).",
    ],
  },
  p2c: {
    title: "Power-of-Two-Choices",
    description:
      "Picks the less-loaded of two random candidates per request — low latency at scale.",
    tips: [
      "Use with 4+ models for best effect.",
      "Requires latency telemetry enabled in Settings.",
      "Great replacement for round-robin in high-throughput combos.",
    ],
  },
  "strict-random": {
    title: "Shuffle deck distribution",
    description: "Each model is used exactly once per cycle before reshuffling.",
    tips: [
      "Use at least 2 models for meaningful distribution.",
      "Ideal for same-model accounts to evenly spread quota.",
      "Guarantees no model is skipped or repeated within a cycle.",
    ],
  },
  auto: {
    title: "Multi-factor optimization",
    description: "Routes based on real-time scoring of cost, latency, quality, and health.",
    tips: [
      "Let the engine balance across multiple factors automatically.",
      "Monitor which factors drive routing decisions in the logs.",
      "Use for complex workloads where no single factor dominates.",
    ],
  },
  lkgp: {
    title: "History-based routing",
    description: "Routes based on historical success rates and persistent performance data.",
    tips: [
      "Let success history accumulate before relying on this strategy.",
      "Models with better track records get preference over time.",
      "Ideal for stable workloads with consistent model availability.",
    ],
  },
  "context-optimized": {
    title: "Context-aware distribution",
    description: "Routes to optimize context window usage and conversation continuity.",
    tips: [
      "Best for long conversations that span multiple requests.",
      "Selects models with appropriate context capacity automatically.",
      "Use when context limits are a bottleneck for your workload.",
    ],
  },
};

function getStrategyGuideText(t, strategy, field) {
  const strategyFallback =
    STRATEGY_GUIDANCE_FALLBACK[strategy] || STRATEGY_GUIDANCE_FALLBACK.priority;
  const key = `strategyGuide.${strategy}.${field}`;
  return getI18nOrFallback(t, key, strategyFallback[field]);
}

function getStrategyRecommendationText(t, strategy, field) {
  const strategyFallback =
    STRATEGY_RECOMMENDATIONS_FALLBACK[strategy] || STRATEGY_RECOMMENDATIONS_FALLBACK.priority;

  if (field === "tips") {
    return strategyFallback.tips.map((tip, index) =>
      getI18nOrFallback(t, `strategyRecommendations.${strategy}.tip${index + 1}`, tip)
    );
  }

  return getI18nOrFallback(
    t,
    `strategyRecommendations.${strategy}.${field}`,
    strategyFallback[field]
  );
}

function StrategyGuidanceCard({ strategy }) {
  const t = useTranslations("combos");
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5">
      <div className="text-[11px] text-text-muted">
        {getI18nOrFallback(t, "strategyGuideTitle", "How to use this strategy")}
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[11px]">
        <p className="text-text-main">
          <span className="font-semibold">
            {getI18nOrFallback(t, "strategyGuideWhen", "When to use")}:
          </span>{" "}
          {getStrategyGuideText(t, strategy, "when")}
        </p>
        <p className="text-text-main">
          <span className="font-semibold">
            {getI18nOrFallback(t, "strategyGuideAvoid", "Avoid when")}:
          </span>{" "}
          {getStrategyGuideText(t, strategy, "avoid")}
        </p>
        <p className="text-text-main">
          <span className="font-semibold">
            {getI18nOrFallback(t, "strategyGuideExample", "Example")}:
          </span>{" "}
          {getStrategyGuideText(t, strategy, "example")}
        </p>
      </div>
    </div>
  );
}

function StrategyRecommendationsPanel({ strategy, onApply, showNudge }) {
  const t = useTranslations("combos");
  const strategyLabel = getStrategyLabel(t, strategy);
  const title = getStrategyRecommendationText(t, strategy, "title");
  const description = getStrategyRecommendationText(t, strategy, "description");
  const tips = getStrategyRecommendationText(t, strategy, "tips");

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.02] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-text-muted">
            {getI18nOrFallback(t, "recommendationsLabel", "Recommended setup")}
          </p>
          <p className="text-xs font-semibold text-text-main mt-0.5">
            {title} · <span className="text-primary">{strategyLabel}</span>
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">{description}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onApply} className="!h-6 px-2 text-[10px]">
          {getI18nOrFallback(t, "applyRecommendations", "Apply recommendations")}
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1">
        {tips.map((tip, index) => (
          <div
            key={`${strategy}-tip-${index + 1}`}
            className="flex items-start gap-1 rounded-md bg-black/[0.02] dark:bg-white/[0.03] px-1.5 py-1"
          >
            <span className="material-symbols-outlined text-[12px] text-primary mt-0.5">check</span>
            <p className="text-[10px] text-text-main">{tip}</p>
          </div>
        ))}
      </div>

      {showNudge && (
        <div
          data-testid="strategy-change-nudge"
          className="mt-2 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] text-primary"
        >
          {getI18nOrFallback(
            t,
            "recommendationsUpdated",
            "Recommendations updated for {strategy}."
          ).replace("{strategy}", strategyLabel)}
        </div>
      )}
    </div>
  );
}

function ComboReadinessPanel({ checks, blockers, showDescription = true }) {
  const t = useTranslations("combos");
  const hasBlockers = blockers.length > 0;

  return (
    <div
      data-testid="combo-readiness-panel"
      className={`rounded-lg border px-2.5 py-2 ${
        hasBlockers
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-emerald-500/20 bg-emerald-500/[0.04]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`material-symbols-outlined text-[14px] ${
            hasBlockers
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {hasBlockers ? "rule" : "check_circle"}
        </span>
        <p className="text-[11px] font-medium text-text-main">
          {getI18nOrFallback(t, "readinessTitle", "Ready to save?")}
        </p>
      </div>

      {showDescription && (
        <p className="text-[10px] text-text-muted mt-0.5">
          {getI18nOrFallback(
            t,
            "readinessDescription",
            "Review the checklist before creating or updating this combo."
          )}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2">
        {checks.map((check) => (
          <div
            key={check.id}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 bg-black/[0.02] dark:bg-white/[0.02]"
          >
            <span
              className={`material-symbols-outlined text-[12px] ${
                check.ok ? "text-emerald-500" : "text-amber-500"
              }`}
            >
              {check.ok ? "task_alt" : "pending"}
            </span>
            <span className="text-[10px] text-text-main">{check.label}</span>
          </div>
        ))}
      </div>

      {hasBlockers && (
        <div
          data-testid="combo-save-blockers"
          className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5"
        >
          <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {getI18nOrFallback(
              t,
              "saveBlockedTitle",
              "Save is blocked until the following items are fixed:"
            )}
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {blockers.map((blocker, index) => (
              <p
                key={`${blocker}-${index}`}
                className="text-[10px] text-amber-700 dark:text-amber-300"
              >
                • {blocker}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export default function ComboFormModal({
  isOpen,
  combo,
  onClose,
  onSave,
  activeProviders,
  comboConfigMode,
}) {
  type CreateDraftSnapshot = {
    name: string;
    models: unknown[];
    strategy: string;
    config: Record<string, unknown>;
    showAdvanced: boolean;
    nameError: string;
    agentSystemMessage: string;
    agentToolFilter: string;
    agentContextCache: boolean;
    contextLength: number | undefined;
  };

  const getEmptyCreateDraftSnapshot = useCallback(
    (): CreateDraftSnapshot => ({
      name: "",
      models: [],
      strategy: "priority",
      config: {},
      showAdvanced: false,
      nameError: "",
      agentSystemMessage: "",
      agentToolFilter: "",
      agentContextCache: false,
      contextLength: undefined,
    }),
    []
  );

  const t = useTranslations("combos");
  const tc = useTranslations("common");
  const emailsVisible = useEmailPrivacyStore((s) => s.emailsVisible);
  const notify = useNotificationStore();
  const isExpertMode = normalizeComboConfigMode(comboConfigMode) === "expert";
  const createDraftStateRef = useRef<CreateDraftSnapshot>(getEmptyCreateDraftSnapshot());
  const [name, setName] = useState(combo?.name || "");
  const [description, setDescription] = useState<string>(combo?.description || "");
  const [models, setModels] = useState(() => {
    return (combo?.models || []).map((m) => normalizeModelEntry(m));
  });
  const [strategy, setStrategy] = useState(combo?.strategy || "priority");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [pricingByProvider, setPricingByProvider] = useState({});
  const [modelAliases, setModelAliases] = useState({});
  const [providerNodes, setProviderNodes] = useState([]);
  const [builderOptions, setBuilderOptions] = useState({ providers: [], comboRefs: [] });
  const [builderLoading, setBuilderLoading] = useState(false);
  const [builderProviderId, setBuilderProviderId] = useState("");
  const [builderModelId, setBuilderModelId] = useState("");
  const [builderConnectionId, setBuilderConnectionId] = useState(COMBO_BUILDER_AUTO_CONNECTION);
  // #3266: optional account allowlist — scopes an auto-selecting step's round-robin
  // to a subset of the provider's connections. Empty = whole active pool.
  const [builderAllowedConnectionIds, setBuilderAllowedConnectionIds] = useState<string[]>([]);
  const [manualModelInput, setManualModelInput] = useState("");
  const [manualModelError, setManualModelError] = useState("");
  const [builderComboRefName, setBuilderComboRefName] = useState("");
  const [builderError, setBuilderError] = useState("");
  const [builderStage, setBuilderStage] = useState<ComboBuilderStage>(COMBO_BUILDER_STAGES[0]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState(sanitizeComboRuntimeConfig(combo?.config));
  const fusionTuning =
    config.fusionTuning && typeof config.fusionTuning === "object"
      ? (config.fusionTuning as Record<string, unknown>)
      : undefined;
  const [showStrategyNudge, setShowStrategyNudge] = useState(false);
  const strategyChangeMountedRef = useRef(false);
  // Agent features (#399 / #401 / #454)
  const [agentSystemMessage, setAgentSystemMessage] = useState<string>(combo?.system_message || "");
  const [agentToolFilter, setAgentToolFilter] = useState<string>(combo?.tool_filter_regex || "");
  const [agentContextCache, setAgentContextCache] = useState<boolean>(
    !!combo?.context_cache_protection
  );
  const [contextLength, setContextLength] = useState<number | undefined>(
    combo?.context_length || undefined
  );
  const [contextLengthError, setContextLengthError] = useState<string>("");
  const comboBuilderStages = useMemo(() => getComboBuilderStages({ strategy }), [strategy]);
  const visibleStageMeta = useMemo(
    () => COMBO_FORM_STAGE_META.filter((stageMeta) => comboBuilderStages.includes(stageMeta.id)),
    [comboBuilderStages]
  );
  const usesIntelligentBuilderStage = isIntelligentBuilderStrategy(strategy);
  const intelligentConfig = useMemo(() => normalizeIntelligentRoutingConfig(config), [config]);

  const resetFormForCombo = useCallback(
    (nextCombo, comboDefaults = null) => {
      const nextDefaults =
        nextCombo || comboDefaults
          ? {
              ...(comboDefaults || {}),
            }
          : {};
      const nextConfig = nextCombo?.config
        ? sanitizeComboRuntimeConfig(nextCombo.config)
        : sanitizeComboRuntimeConfig(
            Object.fromEntries(Object.entries(nextDefaults).filter(([key]) => key !== "strategy"))
          );

      setName(nextCombo?.name || "");
      setDescription(nextCombo?.description || "");
      setModels((nextCombo?.models || []).map((m) => normalizeModelEntry(m)));
      setStrategy(nextCombo?.strategy || comboDefaults?.strategy || "priority");
      setConfig(nextConfig);
      setShowAdvanced(isExpertMode);
      setNameError("");
      setContextLengthError("");
      setAgentSystemMessage(nextCombo?.system_message || "");
      setAgentToolFilter(nextCombo?.tool_filter_regex || "");
      setAgentContextCache(!!nextCombo?.context_cache_protection);
      setContextLength(nextCombo?.context_length || undefined);
    },
    [isExpertMode, setAgentContextCache, setContextLength]
  );

  useEffect(() => {
    createDraftStateRef.current = {
      name,
      models,
      strategy,
      config,
      showAdvanced,
      nameError,
      agentSystemMessage,
      agentToolFilter,
      agentContextCache,
      contextLength,
    };
  }, [
    name,
    models,
    strategy,
    config,
    showAdvanced,
    nameError,
    agentSystemMessage,
    agentToolFilter,
    agentContextCache,
    contextLength,
  ]);

  useEffect(() => {
    if (!comboBuilderStages.includes(builderStage)) {
      setBuilderStage("strategy");
    }
  }, [builderStage, comboBuilderStages]);

  const hasPricingForModel = useCallback(
    (modelValue) => {
      const parsed = parseQualifiedModel(modelValue);
      if (!parsed) return false;

      const { providerId: providerIdentifier, modelId } = parsed;
      const matchedNode = findProviderNodeByIdentifier(providerNodes, providerIdentifier);

      const providerCandidates = [providerIdentifier];
      if (matchedNode?.apiType) providerCandidates.push(matchedNode.apiType);
      if (matchedNode?.name) providerCandidates.push(String(matchedNode.name).toLowerCase());

      return providerCandidates.some((candidate) => !!pricingByProvider?.[candidate]?.[modelId]);
    },
    [pricingByProvider, providerNodes]
  );

  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const builderProviders = useMemo(
    () => builderOptions.providers || [],
    [builderOptions.providers]
  );
  const builderComboRefs = (builderOptions.comboRefs || []).filter(
    (comboRef) => comboRef.name !== combo?.name && comboRef.name !== name.trim()
  );
  const selectedBuilderProvider =
    builderProviders.find((provider) => provider.providerId === builderProviderId) || null;
  const selectedBuilderModel =
    selectedBuilderProvider?.models?.find((model) => model.id === builderModelId) || null;
  const selectedBuilderConnections = selectedBuilderProvider?.connections || [];
  const selectedBuilderConnection =
    builderConnectionId && builderConnectionId !== COMBO_BUILDER_AUTO_CONNECTION
      ? selectedBuilderConnections.find((connection) => connection.id === builderConnectionId) ||
        null
      : null;
  // Defensive: only carry allowlist ids that still belong to the selected provider's
  // connections, so stale ids from a previous provider can never leak into a step.
  const builderEffectiveAllowedConnectionIds = builderAllowedConnectionIds.filter((id) =>
    selectedBuilderConnections.some((connection) => connection.id === id)
  );
  const builderCandidateStep =
    selectedBuilderProvider && selectedBuilderModel
      ? buildPrecisionComboModelStep({
          providerId: selectedBuilderProvider.providerId,
          modelId: selectedBuilderModel.id,
          connectionId:
            builderConnectionId !== COMBO_BUILDER_AUTO_CONNECTION ? builderConnectionId : null,
          connectionLabel: selectedBuilderConnection?.label || null,
          allowedConnectionIds: builderEffectiveAllowedConnectionIds,
        })
      : null;
  const builderHasDuplicate =
    builderCandidateStep && hasExactModelStepDuplicate(models, builderCandidateStep);
  const manualModelStep = buildManualComboModelStep({
    value: manualModelInput,
    providers: builderProviders,
  });
  const manualModelHasDuplicate =
    manualModelStep && hasExactModelStepDuplicate(models, manualModelStep);
  const weightTotal = models.reduce((sum, modelEntry) => sum + (modelEntry.weight || 0), 0);
  const pricedModelCount = models.reduce(
    (count, modelEntry) => count + (hasPricingForModel(modelEntry.model) ? 1 : 0),
    0
  );
  const pricingCoveragePercent =
    models.length > 0 ? Math.round((pricedModelCount / models.length) * 100) : 0;
  const hasNoModels = models.length === 0;
  const hasRoundRobinSingleModel = strategy === "round-robin" && models.length === 1;
  const hasCostOptimizedWithoutPricing =
    strategy === "cost-optimized" && models.length > 0 && pricedModelCount === 0;
  const hasCostOptimizedPartialPricing =
    strategy === "cost-optimized" &&
    models.length > 0 &&
    pricedModelCount > 0 &&
    pricedModelCount < models.length;
  const hasInvalidWeightedTotal =
    strategy === "weighted" && models.length > 0 && weightTotal !== 100;
  const builderStageChecks = getComboBuilderStageChecks({
    name,
    nameError,
    modelsCount: models.length,
    hasInvalidWeightedTotal,
    hasCostOptimizedWithoutPricing,
  });
  const canAdvanceFromCurrentStage =
    builderStage === "basics"
      ? builderStageChecks.basics
      : builderStage === "steps"
        ? builderStageChecks.steps
        : builderStage === "intelligent"
          ? true
          : true;
  const currentStageIndex = visibleStageMeta.findIndex(
    (stageMeta) => stageMeta.id === builderStage
  );
  const pinnedAccountCount = models.filter((entry) => Boolean(entry?.connectionId)).length;
  const comboRefCount = models.filter((entry) => entry?.kind === "combo-ref").length;
  const uniqueProviderCount = new Set(
    models
      .map((entry) => {
        const target = getModelString(entry);
        const parsed = parseQualifiedModel(target);
        return entry?.providerId || parsed?.providerId || null;
      })
      .filter(Boolean)
  ).size;
  const saveBlocked =
    !name.trim() ||
    !!nameError ||
    !!contextLengthError ||
    saving ||
    hasNoModels ||
    hasInvalidWeightedTotal ||
    hasCostOptimizedWithoutPricing;
  const readinessChecks = [
    {
      id: "name",
      ok: !!name.trim() && !nameError,
      label: getI18nOrFallback(t, "readinessCheckName", "Combo name is valid"),
    },
    {
      id: "models",
      ok: !hasNoModels,
      label: getI18nOrFallback(t, "readinessCheckModels", "At least one model is selected"),
    },
    {
      id: "weights",
      ok: strategy === "weighted" ? !hasInvalidWeightedTotal : true,
      label:
        strategy === "weighted"
          ? getI18nOrFallback(t, "readinessCheckWeights", "Weighted total is 100%")
          : getI18nOrFallback(t, "readinessCheckWeightsOptional", "Weight rule not required"),
    },
    {
      id: "pricing",
      ok: strategy === "cost-optimized" ? !hasCostOptimizedWithoutPricing : true,
      label:
        strategy === "cost-optimized"
          ? getI18nOrFallback(t, "readinessCheckPricing", "Pricing data is available")
          : getI18nOrFallback(t, "readinessCheckPricingOptional", "Pricing rule not required"),
    },
  ];
  const saveBlockers = [];
  if (!name.trim()) {
    saveBlockers.push(getI18nOrFallback(t, "saveBlockName", "Define a combo name."));
  } else if (nameError) {
    saveBlockers.push(nameError);
  }
  if (hasNoModels) {
    saveBlockers.push(getI18nOrFallback(t, "saveBlockModels", "Add at least one model."));
  }
  if (hasInvalidWeightedTotal) {
    saveBlockers.push(
      typeof t.has === "function" && t.has("saveBlockWeighted")
        ? t("saveBlockWeighted", { total: weightTotal })
        : `Set weights to 100% (current: ${weightTotal}%).`
    );
  }
  if (hasCostOptimizedWithoutPricing) {
    saveBlockers.push(
      getI18nOrFallback(
        t,
        "saveBlockPricing",
        "Add pricing for at least one model or choose a different strategy."
      )
    );
  }
  const showInlineReadinessPanel = !isExpertMode || saveBlockers.length > 0;

  const fetchModalData = async () => {
    setBuilderLoading(true);
    try {
      const [aliasesRes, nodesRes, pricingRes, builderRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/provider-nodes"),
        fetch("/api/pricing"),
        fetch("/api/combos/builder/options"),
      ]);

      if (!aliasesRes.ok || !nodesRes.ok) {
        throw new Error(
          `Failed to fetch data: aliases=${aliasesRes.status}, nodes=${nodesRes.status}`
        );
      }
      const pricingData = pricingRes.ok ? await pricingRes.json() : {};
      const builderData = builderRes.ok ? await builderRes.json() : {};

      const [aliasesData, nodesData] = await Promise.all([aliasesRes.json(), nodesRes.json()]);
      setPricingByProvider(
        pricingData && typeof pricingData === "object" && !Array.isArray(pricingData)
          ? pricingData
          : {}
      );
      setModelAliases(aliasesData.aliases || {});
      setProviderNodes(nodesData.nodes || []);
      setBuilderOptions({
        providers: builderData.providers || [],
        comboRefs: builderData.comboRefs || [],
      });
    } catch (error) {
      console.error("Error fetching modal data:", error);
      setBuilderOptions({ providers: [], comboRefs: [] });
    } finally {
      setBuilderLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchModalData();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setBuilderProviderId("");
    setBuilderModelId("");
    setBuilderConnectionId(COMBO_BUILDER_AUTO_CONNECTION);
    setBuilderAllowedConnectionIds([]);
    setManualModelInput("");
    setManualModelError("");
    setBuilderComboRefName("");
    setBuilderError("");
    setBuilderStage("basics");
  }, [combo?.id, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    if (combo) {
      resetFormForCombo(combo);
      return () => {
        cancelled = true;
      };
    }

    createDraftStateRef.current = getEmptyCreateDraftSnapshot();
    resetFormForCombo(null, null);

    const loadDefaults = async () => {
      try {
        const response = await fetch("/api/settings/combo-defaults");
        const data = response.ok ? await response.json() : {};
        const draft = createDraftStateRef.current;
        const isPristineDraft =
          draft.name.trim().length === 0 &&
          draft.models.length === 0 &&
          draft.strategy === "priority" &&
          Object.keys(draft.config || {}).length === 0 &&
          (draft.showAdvanced === false || (isExpertMode && draft.showAdvanced === true)) &&
          draft.nameError.length === 0 &&
          draft.agentSystemMessage.length === 0 &&
          draft.agentToolFilter.length === 0 &&
          draft.agentContextCache === false &&
          draft.contextLength === undefined;

        if (!cancelled && isPristineDraft) {
          resetFormForCombo(null, data.comboDefaults || null);
        }
      } catch {
        // Keep the blank create form if defaults fail to load.
      }
    };

    loadDefaults();

    return () => {
      cancelled = true;
    };
  }, [combo, getEmptyCreateDraftSnapshot, isExpertMode, isOpen, resetFormForCombo]);

  useEffect(() => {
    if (!isOpen) return;
    if (builderProviderId) return;
    if (builderProviders.length === 1) {
      setBuilderProviderId(builderProviders[0].providerId);
    }
  }, [builderProviderId, builderProviders, isOpen]);

  useEffect(() => {
    if (!strategyChangeMountedRef.current) {
      strategyChangeMountedRef.current = true;
      return;
    }

    setShowStrategyNudge(true);
    const timeoutId = setTimeout(() => setShowStrategyNudge(false), 2600);
    return () => clearTimeout(timeoutId);
  }, [strategy]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError(t("nameRequired"));
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError(t("nameInvalid"));
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleBuilderProviderChange = (e) => {
    const nextProviderId = e.target.value;
    setBuilderProviderId(nextProviderId);
    setBuilderModelId("");
    setBuilderConnectionId(COMBO_BUILDER_AUTO_CONNECTION);
    setBuilderAllowedConnectionIds([]);
    setBuilderError("");
  };

  const handleBuilderAllowedConnectionToggle = (connectionId: string) => {
    setBuilderAllowedConnectionIds((prev) =>
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    );
    setBuilderError("");
  };

  const handleBuilderModelChange = (e) => {
    const nextModelId = e.target.value;
    setBuilderModelId(nextModelId);
    setBuilderError("");

    if (!nextModelId || !selectedBuilderProvider) {
      setBuilderConnectionId(COMBO_BUILDER_AUTO_CONNECTION);
      return;
    }

    setBuilderConnectionId(
      findNextSuggestedConnectionId(
        models,
        selectedBuilderProvider.providerId,
        nextModelId,
        selectedBuilderProvider.connections || []
      )
    );
  };

  const handleBuilderConnectionChange = (e) => {
    setBuilderConnectionId(e.target.value || COMBO_BUILDER_AUTO_CONNECTION);
    setBuilderError("");
  };

  const handleGoToNextStage = () => {
    setBuilderStage((currentStage) => getNextComboBuilderStage(currentStage, { strategy }));
  };

  const handleGoToPreviousStage = () => {
    setBuilderStage((currentStage) => getPreviousComboBuilderStage(currentStage, { strategy }));
  };

  const handleAddBuilderStep = () => {
    if (!selectedBuilderProvider || !selectedBuilderModel) {
      return;
    }

    const nextStep = buildPrecisionComboModelStep({
      providerId: selectedBuilderProvider.providerId,
      modelId: selectedBuilderModel.id,
      connectionId:
        builderConnectionId !== COMBO_BUILDER_AUTO_CONNECTION ? builderConnectionId : null,
      connectionLabel: selectedBuilderConnection?.label || null,
      allowedConnectionIds: builderEffectiveAllowedConnectionIds,
    });

    if (hasExactModelStepDuplicate(models, nextStep)) {
      setBuilderError(
        getI18nOrFallback(
          t,
          "builderDuplicateExact",
          "This exact provider/model/account step is already in the combo."
        )
      );
      return;
    }

    const nextModels = [...models, nextStep];
    setModels(nextModels);
    setBuilderError("");
    setBuilderAllowedConnectionIds([]);
    setBuilderConnectionId(
      findNextSuggestedConnectionId(
        nextModels,
        selectedBuilderProvider.providerId,
        selectedBuilderModel.id,
        selectedBuilderConnections
      )
    );
  };

  const handleAddManualModel = () => {
    const parsedManualModel = parseQualifiedModel(manualModelInput);
    if (!parsedManualModel) {
      setManualModelError(
        getI18nOrFallback(t, "manualModelInvalid", "Enter a model as provider/model.")
      );
      return;
    }

    const resolvedProviderId = resolveComboBuilderProviderId(
      parsedManualModel.providerId,
      builderProviders
    );
    if (!resolvedProviderId) {
      setManualModelError(
        getI18nOrFallback(t, "manualModelUnknownProvider", "Unknown provider prefix.")
      );
      return;
    }

    const nextStep = buildManualComboModelStep({
      value: manualModelInput,
      providers: builderProviders,
    });

    if (!nextStep) {
      setManualModelError(
        getI18nOrFallback(t, "manualModelInvalid", "Enter a model as provider/model.")
      );
      return;
    }

    if (hasExactModelStepDuplicate(models, nextStep)) {
      setManualModelError(
        getI18nOrFallback(
          t,
          "builderDuplicateExact",
          "This exact provider/model/account step is already in the combo."
        )
      );
      return;
    }

    setModels([...models, nextStep]);
    setManualModelInput("");
    setManualModelError("");
  };

  const handleAddComboReference = () => {
    if (!builderComboRefName) return;

    setModels([
      ...models,
      {
        kind: "combo-ref",
        comboName: builderComboRefName,
        weight: 0,
      },
    ]);
    setBuilderComboRefName("");
    setBuilderError("");
  };

  const handleAddModel = (model) => {
    const qualifiedModel = typeof model?.value === "string" ? model.value : "";
    const parsedModel = parseQualifiedModel(qualifiedModel);
    const resolvedProviderId =
      resolveComboBuilderProviderId(model?.providerId, builderProviders) ||
      resolveComboBuilderProviderId(parsedModel?.providerId, builderProviders) ||
      (typeof model?.providerId === "string" && model.providerId.trim()) ||
      parsedModel?.providerId ||
      null;
    const nextEntry = {
      model: qualifiedModel,
      ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
      weight: 0,
    };
    if (hasExactModelStepDuplicate(models, nextEntry)) {
      setBuilderError(
        getI18nOrFallback(
          t,
          "builderDuplicateExact",
          "This exact provider/model/account step is already in the combo."
        )
      );
      return;
    }
    setModels([...models, nextEntry]);
    setBuilderError("");
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  // Upstream PR decolua/9router#889 (Fajar Hidayat): clicking a model that is
  // already in the combo, inside ModelSelectModal, deselects it in place. We
  // strip every step whose qualified model matches — duplicates with a
  // different providerId/weight that point at the same model id are all
  // removed (matches upstream JS semantics which filtered by a single-string
  // identity).
  const handleDeselectModel = (model) => {
    const value =
      typeof model?.value === "string" ? model.value : typeof model === "string" ? model : "";
    if (!value) return;
    setModels(models.filter((m) => m.model !== value));
    setBuilderError("");
  };

  // Batch add for ModelSelectModal "Select all" — delegates to the pure
  // computeBatchAddModelSteps (src/lib/combos/builderDraft.ts) which applies
  // every candidate against a growing list in one pass, otherwise N× onSelect
  // would each close over the same stale `models` snapshot and keep only the
  // last entry. Extracted so tests exercise this real implementation instead
  // of a hand-maintained mirror (#8526).
  const handleAddModels = (selected) => {
    const { next, addedAny } = computeBatchAddModelSteps(models, selected, builderProviders);
    if (!addedAny) return;
    setModels(next);
    setBuilderError("");
  };

  const handleDeselectModels = (toRemove) => {
    const next = computeBatchDeselectModelSteps(models, toRemove);
    if (next === models) return;
    setModels(next);
    setBuilderError("");
  };

  const handleWeightChange = (index, weight) => {
    const newModels = [...models];
    newModels[index] = {
      ...newModels[index],
      weight: Math.max(0, Math.min(100, Number(weight) || 0)),
    };
    setModels(newModels);
  };

  const handleAutoBalance = () => {
    const count = models.length;
    if (count === 0) return;
    const weight = Math.floor(100 / count);
    const remainder = 100 - weight * count;
    setModels(
      models.map((m, i) => ({
        ...m,
        weight: weight + (i === 0 ? remainder : 0),
      }))
    );
  };

  const applyStrategyRecommendations = () => {
    const strategyDefaults = {
      priority: { maxRetries: 2, retryDelayMs: 1500 },
      weighted: { maxRetries: 1, retryDelayMs: 1000 },
      "round-robin": {
        maxRetries: 1,
        retryDelayMs: 750,
        concurrencyPerModel: 3,
        queueTimeoutMs: 30000,
      },
      "context-relay": {
        maxRetries: 1,
        retryDelayMs: 750,
        handoffThreshold: 0.85,
        maxMessagesForSummary: 30,
      },
      random: { maxRetries: 1, retryDelayMs: 1000 },
      "least-used": { maxRetries: 1, retryDelayMs: 1000 },
      "cost-optimized": { maxRetries: 1, retryDelayMs: 500 },
    };

    const defaults = strategyDefaults[strategy] || strategyDefaults.priority;
    setConfig((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(defaults)) {
        if (next[key] === undefined || next[key] === null || next[key] === "") {
          next[key] = value;
        }
      }
      return next;
    });

    if (strategy === "weighted" && models.length > 1) {
      handleAutoBalance();
    }

    if (strategy === "round-robin" || strategy === "weighted") {
      setShowAdvanced(true);
    }

    notify.success(
      getI18nOrFallback(t, "recommendationsApplied", "Recommendations applied to this combo.")
    );
  };

  const FREE_STACK_PRESET_MODELS = [
    { model: "agy/gemini-3.5-flash-low", weight: 0 },
    { model: "kr/claude-sonnet-4.5", weight: 0 },
    { model: "if/kimi-k2-thinking", weight: 0 },
    { model: "if/qwen3-coder-plus", weight: 0 },
    { model: "if/deepseek-v3.2", weight: 0 },
    { model: "nvidia/llama-3.3-70b-instruct", weight: 0 },
    { model: "groq/llama-3.3-70b-versatile", weight: 0 },
  ];

  const PAID_PREMIUM_PRESET_MODELS = [
    { model: "cu/claude-4.6-opus-high", weight: 0 },
    { model: "antigravity/claude-sonnet-4-6", weight: 0 },
    { model: "cu/claude-4.6-sonnet-high", weight: 0 },
    { model: "antigravity/gemini-pro-agent", weight: 0 },
  ];

  const applyTemplate = (template) => {
    setStrategy(template.strategy);
    setConfig((prev) => ({ ...prev, ...template.config }));
    if (!name.trim()) setName(template.suggestedName);
    if (template.id === "free-stack") {
      setModels(FREE_STACK_PRESET_MODELS);
    } else if (template.id === "paid-premium") {
      setModels(PAID_PREMIUM_PRESET_MODELS);
    }
  };

  // Format model display name with readable provider name
  const formatModelDisplay = useCallback(
    (entry) => {
      return formatComboEntryDisplay(entry, {
        providerNodes,
        builderProviders,
        includeConnection: true,
        showFullEmails: emailsVisible,
      });
    },
    [builderProviders, emailsVisible, providerNodes]
  );

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  // Drag and Drop handlers
  const handleDragStart = (e, index) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
    // Make drag image slightly transparent
    if (e.target) {
      setTimeout(() => ((e.currentTarget as HTMLElement).style.opacity = "0.5"), 0);
    }
  };

  const handleDragEnd = (e) => {
    if (e.target) (e.currentTarget as HTMLElement).style.opacity = "1";
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = dragIndex;
    if (fromIndex === null || fromIndex === dropIndex) return;

    const newModels = [...models];
    const [moved] = newModels.splice(fromIndex, 1);
    newModels.splice(dropIndex, 0, moved);
    setModels(newModels);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    if (hasNoModels || hasInvalidWeightedTotal || hasCostOptimizedWithoutPricing) return;
    setSaving(true);

    const saveData: any = {
      name: name.trim(),
      models,
      strategy,
    };

    // Per-combo description (#5005). Free-text, optional, persisted in combo data.
    if (description.trim()) {
      saveData.description = description.trim();
    } else if (isEdit) {
      // Editing: send null to explicitly clear a previously-set description.
      saveData.description = null;
    }

    const configToSave = sanitizeComboRuntimeConfig(config);
    if (strategy === "round-robin") {
      if (config.concurrencyPerModel !== undefined)
        configToSave.concurrencyPerModel = config.concurrencyPerModel;
      if (config.queueTimeoutMs !== undefined) configToSave.queueTimeoutMs = config.queueTimeoutMs;
      if (config.stickyRoundRobinLimit !== undefined)
        configToSave.stickyRoundRobinLimit = config.stickyRoundRobinLimit;
    }
    if (strategy === "weighted" && config.stickyWeightedLimit !== undefined) {
      configToSave.stickyWeightedLimit = config.stickyWeightedLimit;
    }
    if (
      usesIntelligentBuilderStage &&
      !isExpertMode &&
      (!Array.isArray(configToSave.candidatePool) || configToSave.candidatePool.length === 0)
    ) {
      const derivedCandidatePool = deriveCandidatePoolFromModels(models);
      if (derivedCandidatePool.length > 0) {
        configToSave.candidatePool = derivedCandidatePool;
      }
    }
    const hasConfigToSave = Object.keys(configToSave).length > 0;
    const hadExistingConfig = Object.keys(sanitizeComboRuntimeConfig(combo?.config)).length > 0;
    if (hasConfigToSave || (isEdit && hadExistingConfig)) {
      saveData.config = configToSave;
    }

    // Agent features (#399 / #401 / #454)
    if (agentSystemMessage.trim()) saveData.system_message = agentSystemMessage.trim();
    else delete saveData.system_message;
    if (agentToolFilter.trim()) saveData.tool_filter_regex = agentToolFilter.trim();
    else delete saveData.tool_filter_regex;
    if (agentContextCache) saveData.context_cache_protection = true;
    else delete saveData.context_cache_protection;

    // Validate and save context_length
    if (contextLength !== undefined && contextLength !== null) {
      const ctxLen = Number(contextLength);
      if (isNaN(ctxLen) || !Number.isInteger(ctxLen)) {
        setContextLengthError(t("agentFeaturesContextLengthErrorInteger"));
        setSaving(false);
        return;
      }
      if (ctxLen >= 1000 && ctxLen <= 2000000) {
        saveData.context_length = ctxLen;
      } else {
        setContextLengthError(t("agentFeaturesContextLengthErrorRange"));
        setSaving(false);
        return;
      }
    } else if (isEdit) {
      // Editing: send null to explicitly clear context_length
      saveData.context_length = null;
    } else {
      delete saveData.context_length;
    }

    await onSave(saveData);
    setSaving(false);
  };

  const isEdit = !!combo;
  const showBasicsSection = isExpertMode || builderStage === "basics";
  const showStepsSection = isExpertMode || builderStage === "steps";
  const showStrategySection = isExpertMode || builderStage === "strategy";
  const showIntelligentSection =
    usesIntelligentBuilderStage && (isExpertMode || builderStage === "intelligent");
  const showReviewSection = !isExpertMode && builderStage === "review";
  const advancedConfigVisible = isExpertMode || showAdvanced;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? t("editCombo") : t("createCombo")}
        size="full"
      >
        <div className="flex flex-col gap-3">
          {!isExpertMode && (
            <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-semibold text-text-main">
                    {getI18nOrFallback(t, "builderFlowTitle", "Combo Builder Flow")}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {getI18nOrFallback(
                      t,
                      "builderStagesDescription",
                      "Move through the stages in order to define the combo, build the steps, choose the routing strategy and review the result."
                    )}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                  {Math.max(currentStageIndex + 1, 1)}/{visibleStageMeta.length}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {visibleStageMeta.map((stageMeta, index) => {
                  const isActive = builderStage === stageMeta.id;
                  const canVisitStage = isActive
                    ? true
                    : canAccessComboBuilderStage(stageMeta.id, builderStageChecks, { strategy });
                  const isCompleted =
                    stageMeta.id === "review"
                      ? false
                      : stageMeta.id === "basics"
                        ? builderStageChecks.basics
                        : stageMeta.id === "steps"
                          ? builderStageChecks.steps
                          : stageMeta.id === "intelligent"
                            ? usesIntelligentBuilderStage
                            : builderStageChecks.strategy;

                  return (
                    <button
                      key={stageMeta.id}
                      type="button"
                      data-testid={`combo-builder-stage-${stageMeta.id}`}
                      onClick={() => {
                        if (!canVisitStage) return;
                        setBuilderStage(stageMeta.id);
                      }}
                      disabled={!canVisitStage}
                      className={`text-left rounded-lg border px-3 py-2 transition-all ${
                        isActive
                          ? "border-primary bg-primary/8"
                          : canVisitStage
                            ? "border-black/8 dark:border-white/8 bg-white/60 dark:bg-white/[0.02] hover:border-primary/40"
                            : "border-black/6 dark:border-white/6 bg-black/[0.015] dark:bg-white/[0.015] opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`material-symbols-outlined text-[14px] ${
                            isCompleted && !isActive
                              ? "text-emerald-500"
                              : isActive
                                ? "text-primary"
                                : "text-text-muted"
                          }`}
                        >
                          {isCompleted && !isActive ? "check_circle" : stageMeta.icon}
                        </span>
                        <span className="text-[11px] font-semibold text-text-main">
                          {getI18nOrFallback(
                            t,
                            `builderStage.${stageMeta.id}.label`,
                            stageMeta.fallbackLabel
                          )}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted mt-1 leading-[1.45]">
                        {getI18nOrFallback(
                          t,
                          `builderStage.${stageMeta.id}.description`,
                          stageMeta.fallbackDescription
                        )}
                      </p>
                      <p className="text-[9px] uppercase tracking-wide mt-1 text-text-muted">
                        {index < currentStageIndex
                          ? getI18nOrFallback(t, "builderStageVisited", "Visited")
                          : isActive
                            ? getI18nOrFallback(t, "builderStageCurrent", "Current")
                            : canVisitStage
                              ? getI18nOrFallback(t, "builderStagePending", "Pending")
                              : getI18nOrFallback(t, "builderStageLocked", "Locked")}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showBasicsSection && (
            <>
              {/* Name */}
              <div>
                <Input
                  label={t("comboName")}
                  data-testid="combo-name-input"
                  value={name}
                  onChange={handleNameChange}
                  placeholder={t("comboNamePlaceholder")}
                  error={nameError}
                />
                {!isExpertMode && (
                  <p className="text-[10px] text-text-muted mt-0.5">{t("nameHint")}</p>
                )}
              </div>

              {/* Description (#5005) — optional free-text note for this combo */}
              <div>
                <label className="text-[11px] font-medium text-text-muted block mb-0.5">
                  {getI18nOrFallback(t, "comboDescription", "Description")}
                </label>
                <textarea
                  rows={2}
                  data-testid="combo-description-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={getI18nOrFallback(
                    t,
                    "comboDescriptionPlaceholder",
                    "Optional note describing this combo"
                  )}
                  className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none resize-none"
                />
              </div>

              {!isEdit && !isExpertMode && (
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                  <div className="mb-2">
                    <p className="text-xs font-medium">
                      {getI18nOrFallback(t, "templatesTitle", COMBO_TEMPLATE_FALLBACK.title)}
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {getI18nOrFallback(
                        t,
                        "templatesDescription",
                        COMBO_TEMPLATE_FALLBACK.description
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    {COMBO_TEMPLATES.map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        data-testid={`combo-template-${template.id}`}
                        className={`text-left rounded-md border px-3 py-2 transition-all ${
                          template.isFeatured
                            ? "border-emerald-500/50 bg-emerald-500/5 hover:border-emerald-500/80 hover:bg-emerald-500/10 ring-1 ring-emerald-500/20"
                            : "border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`material-symbols-outlined text-[16px] ${template.isFeatured ? "text-emerald-500" : "text-primary"}`}
                          >
                            {template.icon}
                          </span>
                          <span className="text-[12px] font-semibold text-text-main">
                            {getI18nOrFallback(t, template.titleKey, template.fallbackTitle)}
                          </span>
                          {template.isFeatured && (
                            <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                              FREE
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-text-muted mt-1.5 leading-[1.5]">
                          {getI18nOrFallback(t, template.descKey, template.fallbackDesc)}
                        </p>
                        <p
                          className={`text-[10px] mt-1.5 font-medium ${template.isFeatured ? "text-emerald-500" : "text-primary"}`}
                        >
                          {getI18nOrFallback(t, "templateApply", COMBO_TEMPLATE_FALLBACK.apply)} →
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Strategy Toggle */}
          {showStrategySection && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <label className="text-sm font-medium">{t("routingStrategy")}</label>
                {!isExpertMode && (
                  <Tooltip content={getStrategyDescription(t, strategy)}>
                    <span className="material-symbols-outlined text-[13px] text-text-muted cursor-help">
                      help
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-black/5 dark:bg-white/5 rounded-lg">
                {STRATEGY_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStrategy(s.value)}
                    data-testid={`strategy-option-${s.value}`}
                    title={!isExpertMode ? getStrategyDescription(t, s.value) : undefined}
                    aria-label={
                      isExpertMode
                        ? getStrategyLabel(t, s.value)
                        : `${getStrategyLabel(t, s.value)}. ${getStrategyDescription(t, s.value)}`
                    }
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                      strategy === s.value
                        ? "bg-white dark:bg-white/5 shadow-sm text-primary"
                        : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px] align-middle mr-0.5">
                      {s.icon}
                    </span>
                    {getStrategyLabel(t, s.value)}
                  </button>
                ))}
              </div>
              {!isExpertMode && (
                <>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {getStrategyDescription(t, strategy)}
                  </p>
                  <div className="mt-2">
                    <StrategyGuidanceCard strategy={strategy} />
                  </div>
                  <div className="mt-2">
                    <StrategyRecommendationsPanel
                      strategy={strategy}
                      onApply={applyStrategyRecommendations}
                      showNudge={showStrategyNudge}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {showIntelligentSection && (
            <BuilderIntelligentStep
              t={t}
              config={config}
              activeProviders={builderProviders}
              onChange={(nextIntelligentConfig: any) =>
                setConfig((previousConfig) => ({
                  ...previousConfig,
                  ...nextIntelligentConfig,
                  weights: {
                    ...((previousConfig?.weights as Record<string, unknown> | undefined) || {}),
                    ...(nextIntelligentConfig?.weights || {}),
                  },
                }))
              }
            />
          )}

          {/* Models */}
          {showStepsSection && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">{t("models")}</label>
                {strategy === "weighted" && models.length > 1 && (
                  <button
                    onClick={handleAutoBalance}
                    className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                  >
                    {t("autoBalance")}
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3 mb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-text-main">
                      {getI18nOrFallback(t, "builderTitle", "Precision Builder")}
                    </p>
                    {!isExpertMode && (
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {getI18nOrFallback(
                          t,
                          "builderStepsDescription",
                          "Build each combo step in sequence: provider, model, then account. This allows repeating the same provider and model with different accounts."
                        )}
                      </p>
                    )}
                  </div>
                  {!isExpertMode && (
                    <button
                      type="button"
                      onClick={() => setShowModelSelect(true)}
                      className="text-[10px] shrink-0 text-primary hover:text-primary/80 transition-colors"
                    >
                      {getI18nOrFallback(t, "builderBrowseCatalog", "Legacy model browser")}
                    </button>
                  )}
                </div>

                {isExpertMode && (
                  <div className="mt-3 rounded-md border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] px-2.5 py-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1">
                      {getI18nOrFallback(t, "manualModel", "Manual model")}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={manualModelInput}
                        onChange={(e) => {
                          setManualModelInput(e.target.value);
                          setManualModelError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddManualModel();
                          }
                        }}
                        placeholder="provider/model"
                        data-testid="combo-manual-model-input"
                        className="flex-1 text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-text-main focus:border-primary focus:outline-none font-mono"
                      />
                      <Button
                        onClick={handleAddManualModel}
                        size="sm"
                        disabled={!manualModelInput.trim() || !!manualModelHasDuplicate}
                        data-testid="combo-manual-model-add"
                      >
                        {getI18nOrFallback(t, "addModel", "Add model")}
                      </Button>
                    </div>
                    {(manualModelError || manualModelHasDuplicate) && (
                      <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                        {manualModelError ||
                          getI18nOrFallback(
                            t,
                            "builderDuplicateExact",
                            "This exact provider/model/account step is already in the combo."
                          )}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1">
                      1. {getI18nOrFallback(t, "builderProvider", "Provider")}
                    </label>
                    <select
                      value={builderProviderId}
                      onChange={handleBuilderProviderChange}
                      data-testid="combo-builder-provider"
                      className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-text-main focus:border-primary focus:outline-none"
                    >
                      <option value="">
                        {builderLoading
                          ? getI18nOrFallback(t, "builderLoadingProviders", "Loading providers…")
                          : getI18nOrFallback(t, "builderSelectProvider", "Select provider")}
                      </option>
                      {builderProviders.map((provider) => (
                        <option key={provider.providerId} value={provider.providerId}>
                          {provider.displayName} ({provider.connectionCount} acct
                          {provider.connectionCount === 1 ? "" : "s"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1">
                      2. {getI18nOrFallback(t, "builderModel", "Model")}
                    </label>
                    <select
                      value={builderModelId}
                      onChange={handleBuilderModelChange}
                      disabled={!selectedBuilderProvider}
                      data-testid="combo-builder-model"
                      className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-text-main focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value="">
                        {selectedBuilderProvider
                          ? getI18nOrFallback(t, "builderSelectModel", "Select model")
                          : getI18nOrFallback(t, "builderProviderFirst", "Choose provider first")}
                      </option>
                      {(selectedBuilderProvider?.models || []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                          {model.source ? ` · ${model.source}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1">
                      3. {getI18nOrFallback(t, "builderAccount", "Account")}
                    </label>
                    <select
                      value={builderConnectionId}
                      onChange={handleBuilderConnectionChange}
                      disabled={!selectedBuilderModel}
                      data-testid="combo-builder-account"
                      className="w-full text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-text-main focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value={COMBO_BUILDER_AUTO_CONNECTION}>
                        {getI18nOrFallback(
                          t,
                          "autoSelectAccount",
                          "Auto-select account at runtime"
                        )}
                      </option>
                      {selectedBuilderConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {pickDisplayValue([connection.label], emailsVisible, connection.label)}
                          {connection.status !== "active" ? ` · ${connection.status}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {builderConnectionId === COMBO_BUILDER_AUTO_CONNECTION &&
                selectedBuilderConnections.length > 1 ? (
                  <div className="mt-2 rounded-md border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] px-2.5 py-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1.5">
                      {getI18nOrFallback(
                        t,
                        "builderRestrictAccounts",
                        "Restrict to accounts (optional)"
                      )}
                    </label>
                    <div className="flex flex-wrap gap-1.5" data-testid="combo-builder-allowlist">
                      {selectedBuilderConnections.map((connection) => {
                        const checked = builderAllowedConnectionIds.includes(connection.id);
                        return (
                          <button
                            type="button"
                            key={connection.id}
                            onClick={() => handleBuilderAllowedConnectionToggle(connection.id)}
                            aria-pressed={checked}
                            className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                              checked
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-black/10 dark:border-white/10 text-text-muted hover:border-primary/40"
                            }`}
                          >
                            {pickDisplayValue([connection.label], emailsVisible, connection.label)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-text-muted mt-1.5">
                      {getI18nOrFallback(
                        t,
                        "builderRestrictAccountsHint",
                        "Leave empty to use the whole active pool. When selected, round-robin / weighted picks stay within this subset of accounts."
                      )}
                    </p>
                  </div>
                ) : null}

                {isExpertMode ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      onClick={handleAddBuilderStep}
                      size="sm"
                      disabled={!builderCandidateStep || !!builderHasDuplicate}
                      data-testid="combo-builder-add-step"
                    >
                      {getI18nOrFallback(t, "builderAddStep", "Add detailed step")}
                    </Button>
                    {builderHasDuplicate && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-300">
                        {getI18nOrFallback(
                          t,
                          "builderDuplicateExact",
                          "This exact provider/model/account step is already in the combo."
                        )}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 rounded-md border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">
                      {getI18nOrFallback(t, "builderPreview", "Current step preview")}
                    </p>
                    <p className="text-xs text-text-main mt-1">
                      {builderCandidateStep
                        ? formatModelDisplay(builderCandidateStep)
                        : getI18nOrFallback(
                            t,
                            "previewNextStep",
                            "Choose provider and model to preview the next step."
                          )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <Button
                        onClick={handleAddBuilderStep}
                        size="sm"
                        disabled={!builderCandidateStep || !!builderHasDuplicate}
                        data-testid="combo-builder-add-step"
                      >
                        {getI18nOrFallback(t, "builderAddStep", "Add detailed step")}
                      </Button>
                      {builderHasDuplicate && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-300">
                          {getI18nOrFallback(
                            t,
                            "builderDuplicateExact",
                            "This exact provider/model/account step is already in the combo."
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted block mb-1">
                    {getI18nOrFallback(t, "builderComboRef", "Reference another combo")}
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={builderComboRefName}
                      onChange={(e) => setBuilderComboRefName(e.target.value)}
                      className="flex-1 text-xs py-2 px-2 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-text-main focus:border-primary focus:outline-none"
                    >
                      <option value="">
                        {getI18nOrFallback(
                          t,
                          "selectComboToReference",
                          "Select an existing combo to reference"
                        )}
                      </option>
                      {builderComboRefs.map((comboRef) => (
                        <option key={comboRef.id} value={comboRef.name}>
                          {comboRef.name} · {comboRef.strategy} · {comboRef.stepCount} step
                          {comboRef.stepCount === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={handleAddComboReference}
                      variant="ghost"
                      size="sm"
                      disabled={!builderComboRefName}
                    >
                      {getI18nOrFallback(t, "builderAddComboRef", "Add combo ref")}
                    </Button>
                  </div>
                </div>

                {builderError && (
                  <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    {builderError}
                  </div>
                )}
              </div>

              {models.length === 0 ? (
                <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                  <span className="material-symbols-outlined text-text-muted text-xl mb-1">
                    layers
                  </span>
                  <p className="text-xs text-text-muted">{t("noModelsYet")}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto">
                  {models.map((entry, index) => (
                    <div
                      key={`${entry.model}-${index}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`group/item flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all cursor-grab active:cursor-grabbing ${
                        dragOverIndex === index && dragIndex !== index
                          ? "bg-primary/10 border border-primary/30"
                          : "bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] border border-transparent"
                      } ${dragIndex === index ? "opacity-50" : ""}`}
                    >
                      {/* Drag handle */}
                      <span className="material-symbols-outlined text-[14px] text-text-muted/40 cursor-grab shrink-0">
                        drag_indicator
                      </span>

                      {/* Index badge */}
                      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">
                        {index + 1}
                      </span>

                      {/* Model display */}
                      <div className="flex-1 min-w-0 px-1">
                        <div className="text-xs text-text-main truncate">
                          {formatModelDisplay(entry)}
                        </div>
                        <div className="text-[10px] text-text-muted truncate">
                          {entry.kind === "combo-ref"
                            ? getI18nOrFallback(t, "builderComboRefStep", "Nested combo reference")
                            : entry.connectionId
                              ? getI18nOrFallback(t, "builderPinnedAccount", "Pinned account")
                              : entry.providerId
                                ? getI18nOrFallback(
                                    t,
                                    "builderDynamicAccountShort",
                                    "Dynamic account"
                                  )
                                : getI18nOrFallback(t, "builderLegacyEntry", "Legacy model entry")}
                        </div>
                      </div>

                      {strategy === "cost-optimized" && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase font-semibold ${
                            hasPricingForModel(entry.model)
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          }`}
                          title={
                            hasPricingForModel(entry.model)
                              ? getI18nOrFallback(t, "pricingAvailable", "Pricing available")
                              : getI18nOrFallback(t, "pricingMissing", "No pricing")
                          }
                        >
                          {hasPricingForModel(entry.model)
                            ? getI18nOrFallback(t, "pricingAvailableShort", "priced")
                            : getI18nOrFallback(t, "pricingMissingShort", "no-price")}
                        </span>
                      )}

                      {/* Weight input (weighted mode only) */}
                      {strategy === "weighted" && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={entry.weight}
                            onChange={(e) => handleWeightChange(index, e.target.value)}
                            className="w-10 text-[11px] text-center py-0.5 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                          />
                          <span className="text-[10px] text-text-muted">%</span>
                        </div>
                      )}

                      {/* Reorder arrows (Mobile friendly) */}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          className={`p-0.5 rounded ${index === 0 ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
                          title={t("moveUp")}
                        >
                          <span className="material-symbols-outlined text-[12px]">
                            arrow_upward
                          </span>
                        </button>
                        <button
                          onClick={() => handleMoveDown(index)}
                          disabled={index === models.length - 1}
                          className={`p-0.5 rounded ${index === models.length - 1 ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
                          title={t("moveDown")}
                        >
                          <span className="material-symbols-outlined text-[12px]">
                            arrow_downward
                          </span>
                        </button>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => handleRemoveModel(index)}
                        className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
                        title={t("removeModel")}
                      >
                        <span className="material-symbols-outlined text-[12px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Weight total indicator */}
              {strategy === "weighted" && models.length > 0 && <WeightTotalBar models={models} />}

              {strategy === "cost-optimized" && models.length > 0 && (
                <div className="mt-2 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] px-2 py-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted">
                      {getI18nOrFallback(t, "pricingCoverage", "Pricing coverage")}
                    </span>
                    <span className="font-medium text-text-main">
                      {pricedModelCount}/{models.length} ({pricingCoveragePercent}%)
                    </span>
                  </div>
                  <div className="h-1.5 mt-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        pricingCoveragePercent === 100
                          ? "bg-emerald-500"
                          : pricingCoveragePercent > 0
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${pricingCoveragePercent}%` }}
                    />
                  </div>
                  {!isExpertMode && (
                    <p className="text-[10px] text-text-muted mt-1">
                      {getI18nOrFallback(
                        t,
                        "pricingCoverageHint",
                        "Cost-optimized works best when all combo models have pricing."
                      )}
                    </p>
                  )}
                </div>
              )}

              {hasNoModels && (
                <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span>{t("noModelsYet")}</span>
                </div>
              )}

              {hasInvalidWeightedTotal && (
                <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span>
                    {t("weighted")} {weightTotal}% {"\u2260"} 100%. {t("autoBalance")}
                  </span>
                </div>
              )}

              {!isExpertMode && hasRoundRobinSingleModel && (
                <div className="mt-2 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1.5 text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">info</span>
                  <span>
                    {getI18nOrFallback(
                      t,
                      "warningRoundRobinSingleModel",
                      "Round-robin is most useful with at least 2 models."
                    )}
                  </span>
                </div>
              )}

              {hasCostOptimizedPartialPricing && (
                <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span>
                    {typeof t.has === "function" && t.has("warningCostOptimizedPartialPricing")
                      ? t("warningCostOptimizedPartialPricing", {
                          priced: pricedModelCount,
                          total: models.length,
                        })
                      : `Only ${pricedModelCount} of ${models.length} models have pricing. Routing may be partially cost-aware.`}
                  </span>
                </div>
              )}

              {hasCostOptimizedWithoutPricing && (
                <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">warning</span>
                  <span>
                    {getI18nOrFallback(
                      t,
                      "warningCostOptimizedNoPricing",
                      "No pricing data found for this combo. Cost-optimized may route unexpectedly."
                    )}
                  </span>
                </div>
              )}

              {showInlineReadinessPanel && (
                <div className="mt-2">
                  <ComboReadinessPanel
                    checks={readinessChecks}
                    blockers={saveBlockers}
                    showDescription={!isExpertMode}
                  />
                </div>
              )}

              <button
                onClick={() => setShowModelSelect(true)}
                className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-text-muted hover:text-primary hover:border-primary/30 transition-colors flex items-center justify-center gap-1"
                data-testid="combo-browse-catalog"
              >
                <span className="material-symbols-outlined text-[16px]">travel_explore</span>
                {getI18nOrFallback(t, "browseLegacyCatalog", "Browse legacy model catalog")}
              </button>
            </div>
          )}

          {/* Advanced Config Toggle */}
          {showStrategySection && (
            <>
              {!isExpertMode && (
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text-main transition-colors self-start"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {showAdvanced ? "expand_less" : "expand_more"}
                  </span>
                  {t("advancedSettings")}
                </button>
              )}

              {advancedConfigVisible && (
                <div className="flex flex-col gap-2 p-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-black/5 dark:border-white/5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabelWithHelp
                        label={t("maxRetries")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.maxRetries",
                          ADVANCED_FIELD_HELP_FALLBACK.maxRetries
                        )}
                        showHelp={!isExpertMode}
                      />
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={toInputValue(config.maxRetries)}
                        placeholder="1"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            maxRetries: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <FieldLabelWithHelp
                        label={t("retryDelay")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.retryDelay",
                          ADVANCED_FIELD_HELP_FALLBACK.retryDelay
                        )}
                        showHelp={!isExpertMode}
                      />
                      <input
                        type="number"
                        min="0"
                        max="60000"
                        step="500"
                        value={toInputValue(config.retryDelayMs)}
                        placeholder="2000"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            retryDelayMs: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <FieldLabelWithHelp
                        label={getI18nOrFallback(t, "targetTimeout", "Target timeout (seconds)")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.targetTimeoutMs",
                          ADVANCED_FIELD_HELP_FALLBACK.targetTimeoutMs
                        )}
                        showHelp={!isExpertMode}
                        htmlFor="combo-target-timeout-ms"
                      />
                      <input
                        id="combo-target-timeout-ms"
                        type="number"
                        min="1"
                        max="86400"
                        step="1"
                        value={msToOptionalSecondsInput(config.targetTimeoutMs)}
                        placeholder={getI18nOrFallback(t, "inheritRequestTimeout", "inherit")}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            targetTimeoutMs: secondsInputToOptionalMs(e.target.value),
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                    <div className="col-span-2">
                      <div className="flex items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          id="failoverBeforeRetry"
                          checked={!!config.failoverBeforeRetry}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              failoverBeforeRetry: e.target.checked || undefined,
                            })
                          }
                          className="w-3.5 h-3.5 rounded border border-black/20 dark:border-white/20 accent-primary cursor-pointer"
                        />
                        <label
                          htmlFor="failoverBeforeRetry"
                          className="text-xs text-text-muted cursor-pointer select-none"
                        >
                          {t("failoverBeforeRetry")}
                        </label>
                        <Tooltip
                          position="bottom"
                          content={getI18nOrFallback(
                            t,
                            "advancedHelp.failoverBeforeRetry",
                            ADVANCED_FIELD_HELP_FALLBACK.failoverBeforeRetry
                          )}
                        >
                          <span className="material-symbols-outlined text-[12px] text-text-muted cursor-help">
                            help
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <ReasoningTokenBufferToggle config={config} setConfig={setConfig} t={t} />
                    </div>
                    <div>
                      <FieldLabelWithHelp
                        label={t("maxSetRetries")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.maxSetRetries",
                          ADVANCED_FIELD_HELP_FALLBACK.maxSetRetries
                        )}
                        showHelp={!isExpertMode}
                      />
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={toInputValue(config.maxSetRetries)}
                        placeholder="0"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            maxSetRetries: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <FieldLabelWithHelp
                        label={t("setRetryDelayMs")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.setRetryDelayMs",
                          ADVANCED_FIELD_HELP_FALLBACK.setRetryDelayMs
                        )}
                        showHelp={!isExpertMode}
                      />
                      <input
                        type="number"
                        min="0"
                        max="60000"
                        step="500"
                        value={toInputValue(config.setRetryDelayMs)}
                        placeholder="2000"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            setRetryDelayMs: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                  {strategy === "round-robin" && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                      <div>
                        <FieldLabelWithHelp
                          label={t("concurrencyPerModel")}
                          help={getI18nOrFallback(
                            t,
                            "advancedHelp.concurrencyPerModel",
                            ADVANCED_FIELD_HELP_FALLBACK.concurrencyPerModel
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={toInputValue(config.concurrencyPerModel)}
                          placeholder="3"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              concurrencyPerModel: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <FieldLabelWithHelp
                          label={t("queueTimeout")}
                          help={getI18nOrFallback(
                            t,
                            "advancedHelp.queueTimeout",
                            ADVANCED_FIELD_HELP_FALLBACK.queueTimeout
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="1000"
                          max="120000"
                          step="1000"
                          value={toInputValue(config.queueTimeoutMs)}
                          placeholder="30000"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              queueTimeoutMs: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="col-span-2">
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(t, "stickyLimit", "Sticky Limit")}
                          help={getI18nOrFallback(
                            t,
                            "advancedHelp.stickyLimit",
                            ADVANCED_FIELD_HELP_FALLBACK.stickyLimit
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={toInputValue(config.stickyRoundRobinLimit)}
                          placeholder={getI18nOrFallback(t, "stickyLimitInherit", "inherit")}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              stickyRoundRobinLimit: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                  {strategy === "weighted" && (
                    <div className="grid grid-cols-1 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(
                            t,
                            "stickyWeightedLimit",
                            "Sticky Weighted Limit"
                          )}
                          help={getI18nOrFallback(
                            t,
                            "advancedHelp.stickyWeightedLimit",
                            ADVANCED_FIELD_HELP_FALLBACK.stickyWeightedLimit
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={toInputValue(config.stickyWeightedLimit)}
                          placeholder="1"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              stickyWeightedLimit: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                    <div>
                      <FieldLabelWithHelp
                        label={getI18nOrFallback(t, "nestedComboMode", "Nested Combo Behavior")}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.nestedComboMode",
                          ADVANCED_FIELD_HELP_FALLBACK.nestedComboMode
                        )}
                        showHelp={!isExpertMode}
                      />
                      <select
                        value={toInputValue(config.nestedComboMode ?? "flatten")}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            nestedComboMode: e.target.value === "execute" ? "execute" : "flatten",
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-surface-1 focus:border-primary focus:outline-none"
                      >
                        <option value="flatten">
                          {getI18nOrFallback(t, "nestedComboFlatten", "Flatten nested combos")}
                        </option>
                        <option value="execute">
                          {getI18nOrFallback(
                            t,
                            "nestedComboExecute",
                            "Execute nested combos as targets"
                          )}
                        </option>
                      </select>
                    </div>
                    {/* #6168: per-combo session-stickiness override (tri-state so it can
                        force ON or OFF regardless of the global default; blank = inherit). */}
                    <div>
                      <FieldLabelWithHelp
                        label={getI18nOrFallback(
                          t,
                          "disableSessionStickiness",
                          "Disable session stickiness"
                        )}
                        help={getI18nOrFallback(
                          t,
                          "advancedHelp.disableSessionStickiness",
                          "Rotate to a different connection on every request instead of pinning a whole conversation to one connection by the first-message hash. Overrides the global default. Leave on Inherit to preserve prompt-cache hits for multi-turn chats."
                        )}
                        showHelp={!isExpertMode}
                      />
                      <select
                        value={
                          config.disableSessionStickiness === true
                            ? "disabled"
                            : config.disableSessionStickiness === false
                              ? "enabled"
                              : "inherit"
                        }
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            disableSessionStickiness:
                              e.target.value === "disabled"
                                ? true
                                : e.target.value === "enabled"
                                  ? false
                                  : undefined,
                          })
                        }
                        className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-surface-1 focus:border-primary focus:outline-none"
                      >
                        <option value="inherit">
                          {getI18nOrFallback(t, "stickyLimitInherit", "inherit")}
                        </option>
                        <option value="enabled">
                          {getI18nOrFallback(t, "sessionStickinessEnabled", "Stickiness on")}
                        </option>
                        <option value="disabled">
                          {getI18nOrFallback(t, "sessionStickinessDisabled", "Stickiness off")}
                        </option>
                      </select>
                    </div>
                  </div>
                  {strategy === "context-relay" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(
                            t,
                            "contextRelayHandoffThreshold",
                            "Handoff Threshold"
                          )}
                          help={getI18nOrFallback(
                            t,
                            "contextRelayHandoffThresholdHelp",
                            "When quota usage reaches this threshold, OmniRoute generates a structured handoff summary before the account is exhausted."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="0.5"
                          max="0.94"
                          step="0.01"
                          value={toInputValue(config.handoffThreshold)}
                          placeholder="0.85"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              handoffThreshold: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(
                            t,
                            "contextRelayMaxMessages",
                            "Max Messages For Summary"
                          )}
                          help={getI18nOrFallback(
                            t,
                            "contextRelayMaxMessagesHelp",
                            "Limits how much recent history is condensed into the relay summary."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="5"
                          max="100"
                          value={toInputValue(config.maxMessagesForSummary)}
                          placeholder="30"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              maxMessagesForSummary: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(t, "contextRelaySummaryModel", "Summary Model")}
                          help={getI18nOrFallback(
                            t,
                            "contextRelaySummaryModelHelp",
                            "Optional override model used only for generating the handoff summary. Leave empty to reuse the active combo model."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="text"
                          value={toInputValue(config.handoffModel)}
                          placeholder="codex/gpt-5.6-sol"
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              handoffModel: e.target.value || undefined,
                            })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      {!isExpertMode && (
                        <div className="md:col-span-3 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-2 py-1.5">
                          <p className="text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                            {getI18nOrFallback(
                              t,
                              "contextRelayProviderNote",
                              "Context Relay currently generates handoffs for Codex account rotation. Pair it with multiple accounts of the same provider for the best continuity."
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {strategy === "fusion" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                      <div className="md:col-span-2">
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(t, "fusionJudgeModel", "Judge model")}
                          help={getI18nOrFallback(
                            t,
                            "fusionJudgeModelHelp",
                            "Model that synthesizes the panel answers into one final response. Leave empty to use the first panel model."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="text"
                          value={toInputValue(config.judgeModel)}
                          placeholder={models[0]?.model || "openai/gpt-5.5"}
                          onChange={(e) =>
                            setConfig({ ...config, judgeModel: e.target.value || undefined })
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(t, "fusionMinPanel", "Min panel")}
                          help={getI18nOrFallback(
                            t,
                            "fusionMinPanelHelp",
                            "Successful panel answers required before stragglers get a grace window (default 2)."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={toInputValue(fusionTuning?.minPanel)}
                          placeholder="2"
                          onChange={(e) =>
                            setConfig(updateFusionTuning(config, "minPanel", e.target.value))
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(
                            t,
                            "fusionStragglerGraceMs",
                            "Straggler grace (ms)"
                          )}
                          help={getI18nOrFallback(
                            t,
                            "fusionStragglerGraceMsHelp",
                            "How long to wait for slow panel models once quorum is reached (default 8000)."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="0"
                          max="120000"
                          value={toInputValue(fusionTuning?.stragglerGraceMs)}
                          placeholder="8000"
                          onChange={(e) =>
                            setConfig(
                              updateFusionTuning(config, "stragglerGraceMs", e.target.value)
                            )
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldLabelWithHelp
                          label={getI18nOrFallback(
                            t,
                            "fusionPanelHardTimeoutMs",
                            "Panel hard timeout (ms)"
                          )}
                          help={getI18nOrFallback(
                            t,
                            "fusionPanelHardTimeoutMsHelp",
                            "Absolute cap so one hung model can't stall the whole panel (default 90000)."
                          )}
                          showHelp={!isExpertMode}
                        />
                        <input
                          type="number"
                          min="1000"
                          max="600000"
                          value={toInputValue(fusionTuning?.panelHardTimeoutMs)}
                          placeholder="90000"
                          onChange={(e) =>
                            setConfig(
                              updateFusionTuning(config, "panelHardTimeoutMs", e.target.value)
                            )
                          }
                          className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                  {!isExpertMode && (
                    <p className="text-[10px] text-text-muted">{t("advancedHint")}</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Response Validation (4985) */}
          {showStrategySection && (
            <div className="flex flex-col gap-2 p-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-black/5 dark:border-white/5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-[14px] text-primary">rule</span>
                <p className="text-xs font-medium">
                  {getI18nOrFallback(t, "responseValidationTitle", "Response validation")}
                </p>
              </div>
              <ResponseValidationEditor
                value={config.responseValidation as ResponseValidationValue | undefined}
                onChange={(next) => setConfig({ ...config, responseValidation: next })}
                t={t}
              />
            </div>
          )}

          {/* Agent Features (#399 / #401 / #454) */}
          {showStrategySection && (
            <div className="flex flex-col gap-2 p-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-black/5 dark:border-white/5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="material-symbols-outlined text-[14px] text-primary">
                  smart_toy
                </span>
                <p className="text-xs font-medium">
                  {getI18nOrFallback(t, "agentFeaturesTitle", "Agent features")}
                </p>
                {!isExpertMode && (
                  <span className="text-[10px] text-text-muted">
                    {getI18nOrFallback(
                      t,
                      "agentFeaturesDescription",
                      "Tune agent prompts and tool access for this combo."
                    )}
                  </span>
                )}
              </div>

              {/* System Message Override */}
              <div>
                <label className="text-[11px] font-medium text-text-muted block mb-0.5">
                  {getI18nOrFallback(
                    t,
                    "agentFeaturesSystemMessageOverride",
                    "System message override"
                  )}
                </label>
                <textarea
                  rows={2}
                  value={agentSystemMessage}
                  onChange={(e) => setAgentSystemMessage(e.target.value)}
                  placeholder={getI18nOrFallback(
                    t,
                    "agentFeaturesSystemMessagePlaceholder",
                    "Optional system instructions for this combo"
                  )}
                  className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none resize-none"
                />
                {!isExpertMode && (
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {getI18nOrFallback(
                      t,
                      "agentFeaturesSystemMessageHint",
                      "Applied only when this combo is used as an agent."
                    )}
                  </p>
                )}
              </div>

              {/* Tool Filter Regex */}
              <div>
                <label className="text-[11px] font-medium text-text-muted block mb-0.5">
                  {getI18nOrFallback(t, "agentFeaturesToolFilterRegex", "Tool filter regex")}
                </label>
                <input
                  type="text"
                  value={agentToolFilter}
                  onChange={(e) => setAgentToolFilter(e.target.value)}
                  placeholder="e.g. ^(bash|computer)$"
                  className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none font-mono"
                />
                {!isExpertMode && (
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {getI18nOrFallback(
                      t,
                      "agentFeaturesToolFilterHint",
                      "Limit agent tools by name with a regular expression."
                    )}
                  </p>
                )}
              </div>

              {/* Context Cache Protection */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="text-[11px] font-medium text-text-muted block">
                    {getI18nOrFallback(
                      t,
                      "agentFeaturesContextCacheProtection",
                      "Context cache protection"
                    )}
                  </label>
                  {!isExpertMode && (
                    <p className="text-[10px] text-text-muted">
                      {getI18nOrFallback(
                        t,
                        "agentFeaturesContextCacheHint",
                        "Keep cached context isolated when provider state changes."
                      )}
                    </p>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={agentContextCache}
                  onChange={(e) => setAgentContextCache(e.target.checked)}
                  className="accent-primary shrink-0"
                />
              </div>

              {/* Context Length */}
              <div>
                <label className="text-[11px] font-medium text-text-muted block mb-0.5">
                  {getI18nOrFallback(t, "agentFeaturesContextLength", "Context length")}
                </label>
                <input
                  type="number"
                  min="1000"
                  max="2000000"
                  step="1000"
                  value={contextLength || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContextLengthError("");
                    if (value === "") {
                      setContextLength(undefined);
                      return;
                    }
                    const num = Number(value);
                    if (isNaN(num) || !Number.isInteger(num)) {
                      setContextLengthError(t("agentFeaturesContextLengthErrorInteger"));
                      // Keep the raw input value so the user can correct it
                    } else if (num < 1000 || num > 2000000) {
                      setContextLengthError(t("agentFeaturesContextLengthErrorRange"));
                      setContextLength(num);
                    } else {
                      setContextLength(num);
                    }
                  }}
                  placeholder={getI18nOrFallback(
                    t,
                    "agentFeaturesContextLengthPlaceholder",
                    "e.g. 128000"
                  )}
                  className="w-full text-xs py-1.5 px-2 rounded border border-black/10 dark:border-white/10 bg-transparent focus:border-primary focus:outline-none"
                />
                {contextLengthError && (
                  <p className="text-[10px] text-red-500 mt-0.5">{contextLengthError}</p>
                )}
                {!contextLengthError && !isExpertMode && (
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {getI18nOrFallback(
                      t,
                      "agentFeaturesContextLengthHint",
                      "Defines the context window for this combo in /v1/models."
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {showReviewSection && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewName", "Name")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1 break-all">
                    {name || "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewStrategy", "Strategy")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">
                    {getStrategyLabel(t, strategy)}
                  </p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewSteps", "Steps")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">{models.length}</p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewAccounts", "Pinned accounts")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">{pinnedAccountCount}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewProviders", "Providers")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">{uniqueProviderCount}</p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewComboRefs", "Combo refs")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">{comboRefCount}</p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewAdvanced", "Advanced config")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">
                    {Object.keys(config || {}).length}
                  </p>
                </div>
                <div className="rounded-lg border border-black/8 dark:border-white/8 bg-white/70 dark:bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {getI18nOrFallback(t, "reviewAgentFlags", "Agent flags")}
                  </p>
                  <p className="text-sm font-semibold text-text-main mt-1">
                    {
                      [
                        agentSystemMessage,
                        agentToolFilter,
                        agentContextCache ? "cache" : "",
                      ].filter(Boolean).length
                    }
                  </p>
                </div>
              </div>

              {usesIntelligentBuilderStage && (
                <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[16px]">
                      auto_awesome
                    </span>
                    <p className="text-sm font-semibold text-text-main">
                      {getI18nOrFallback(t, "reviewIntelligentTitle", "Intelligent Routing Config")}
                    </p>
                  </div>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 text-sm">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {getI18nOrFallback(t, "modePackLabel", "Mode Pack")}
                      </dt>
                      <dd className="text-text-main mt-1">{intelligentConfig.modePack}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {getI18nOrFallback(t, "routerStrategyLabel", "Router Strategy")}
                      </dt>
                      <dd className="text-text-main mt-1">{intelligentConfig.routerStrategy}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {getI18nOrFallback(t, "explorationRateLabel", "Exploration Rate")}
                      </dt>
                      <dd className="text-text-main mt-1">
                        {Math.round(intelligentConfig.explorationRate * 100)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {getI18nOrFallback(t, "candidatePoolLabel", "Candidate Pool")}
                      </dt>
                      <dd className="text-text-main mt-1">
                        {intelligentConfig.candidatePool.length > 0
                          ? intelligentConfig.candidatePool.length
                          : getI18nOrFallback(t, "candidatePoolAllProviders", "All providers")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {getI18nOrFallback(t, "budgetCapLabel", "Budget Cap (USD / request)")}
                      </dt>
                      <dd className="text-text-main mt-1">
                        {intelligentConfig.budgetCap
                          ? `$${intelligentConfig.budgetCap}`
                          : getI18nOrFallback(t, "budgetCapPlaceholder", "No limit")}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              <div className="rounded-lg border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-3">
                <p className="text-xs font-semibold text-text-main">
                  {getI18nOrFallback(t, "reviewSequence", "Execution sequence")}
                </p>
                <div className="mt-2 flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
                  {models.length === 0 ? (
                    <p className="text-[11px] text-text-muted">
                      {getI18nOrFallback(t, "reviewNoSteps", "No steps added yet.")}
                    </p>
                  ) : (
                    models.map((entry, index) => (
                      <div
                        key={`${getModelString(entry) || "entry"}-${index}`}
                        className="rounded-md border border-black/6 dark:border-white/6 bg-white/70 dark:bg-white/[0.03] px-2.5 py-2"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold text-text-muted mt-0.5">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-text-main truncate">
                              {formatModelDisplay(entry)}
                            </p>
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {entry.kind === "combo-ref"
                                ? getI18nOrFallback(
                                    t,
                                    "builderComboRefStep",
                                    "Nested combo reference"
                                  )
                                : entry.connectionId
                                  ? getI18nOrFallback(t, "builderPinnedAccount", "Pinned account")
                                  : entry.providerId
                                    ? getI18nOrFallback(
                                        t,
                                        "builderDynamicAccountShort",
                                        "Dynamic account"
                                      )
                                    : getI18nOrFallback(
                                        t,
                                        "builderLegacyEntry",
                                        "Legacy model entry"
                                      )}
                              {strategy === "weighted" && entry.weight > 0
                                ? ` · ${entry.weight}%`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <ComboReadinessPanel checks={readinessChecks} blockers={saveBlockers} />
            </div>
          )}

          {isExpertMode ? (
            <div className="flex gap-2 pt-1">
              <Button onClick={onClose} variant="ghost" fullWidth size="sm">
                {tc("cancel")}
              </Button>
              <Button onClick={handleSave} fullWidth size="sm" disabled={saveBlocked}>
                {saving ? t("saving") : isEdit ? tc("save") : t("createCombo")}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button
                onClick={builderStage === "basics" ? onClose : handleGoToPreviousStage}
                variant="ghost"
                fullWidth
                size="sm"
                data-testid="combo-builder-back"
              >
                {builderStage === "basics" ? tc("cancel") : getI18nOrFallback(tc, "back", "Back")}
              </Button>
              {builderStage === "review" ? (
                <Button onClick={handleSave} fullWidth size="sm" disabled={saveBlocked}>
                  {saving ? t("saving") : isEdit ? tc("save") : t("createCombo")}
                </Button>
              ) : (
                <Button
                  onClick={handleGoToNextStage}
                  fullWidth
                  size="sm"
                  disabled={!canAdvanceFromCurrentStage}
                  data-testid="combo-builder-next"
                >
                  {getI18nOrFallback(tc, "next", "Next")}
                </Button>
              )}
            </div>
          )}

          {(isExpertMode || builderStage !== "review") && !canAdvanceFromCurrentStage && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
              {builderStage === "basics"
                ? getI18nOrFallback(
                    t,
                    "builderNeedValidName",
                    "Define a valid combo name before continuing."
                  )
                : getI18nOrFallback(
                    t,
                    "addStepBeforeContinue",
                    "Add at least one step before continuing to the next stage."
                  )}
            </div>
          )}
        </div>
      </Modal>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        onSelectMany={handleAddModels}
        onDeselectMany={handleDeselectModels}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={t("addModelToCombo")}
        selectedModel={null}
        addedModelValues={models.map((m) => m.model)}
        keepOpenOnSelect
      />
    </>
  );
}
