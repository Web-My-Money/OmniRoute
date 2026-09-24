import { ROUTING_STRATEGIES } from "@/shared/constants/routingStrategies";
import { parseQualifiedModel } from "@/lib/combos/builderDraft";
import { pickDisplayValue } from "@/shared/utils/maskEmail";

export const STRATEGY_OPTIONS = ROUTING_STRATEGIES.map((strategy) => ({
  value: strategy.value,
  labelKey: strategy.labelKey,
  descKey: strategy.combosDescKey,
  icon: strategy.icon,
}));

export const STRATEGY_LABEL_FALLBACK = {
  "context-relay": "Context Relay",
  "reset-aware": "Reset-Aware RR",
};

export const STRATEGY_DESC_FALLBACK = {
  "context-relay":
    "Priority-style routing with automatic context handoffs when account rotation happens.",
  "reset-aware":
    "Quota remaining and reset windows decide the order; similar scores rotate round-robin.",
};

export const LEGACY_COMBO_RESILIENCE_KEYS = new Set([
  "timeoutMs",
  "healthCheckEnabled",
  "healthCheckTimeoutMs",
  "queueTimeoutMs",
  "queueDepth",
  "fallbackDelayMs",
  "handoffProviders",
  "maxComboDepth",
  "manifestRouting",
  "complexityAwareRouting",
  "pipeline_enabled",
  "pipelineConcurrency",
  "shadowRouting",
  "evalRouting",
  "resetAwareEnabled",
  "resetAwareWindow",
]);
export const MS_PER_SECOND = 1000;

export function sanitizeComboRuntimeConfig(config) {
  if (!config || typeof config !== "object") return {};
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        value !== undefined && value !== null && !LEGACY_COMBO_RESILIENCE_KEYS.has(key)
    )
  );
}

export const COMBO_TEMPLATE_FALLBACK = {
  title: "Quick templates",
  description: "Apply a starting profile, then adjust models and config.",
  apply: "Apply template",
  highAvailabilityTitle: "High availability",
  highAvailabilityDesc: "Priority routing with health checks and safe retries.",
  costSaverTitle: "Cost saver",
  costSaverDesc: "Cost-optimized routing for budget-first workloads.",
  balancedTitle: "Balanced load",
  balancedDesc: "Least-used routing to spread demand over time.",
  freeStackTitle: "Free Stack ($0)",
  freeStackDesc:
    "Round-robin across free providers: Kiro, Qoder, Antigravity CLI. Zero cost, never stops.",
  paidPremiumTitle: "Paid Premium",
  paidPremiumDesc:
    "Round-robin across paid subscriptions: Cursor, Antigravity. Top-tier models, distributed load.",
};

export function getStrategyMeta(strategy) {
  return STRATEGY_OPTIONS.find((s) => s.value === strategy) || STRATEGY_OPTIONS[0];
}

export function getStrategyLabel(t, strategy) {
  const key = getStrategyMeta(strategy).labelKey;
  return getI18nOrFallback(t, key, STRATEGY_LABEL_FALLBACK[strategy] || strategy);
}

export function getStrategyDescription(t, strategy) {
  const key = getStrategyMeta(strategy).descKey;
  return getI18nOrFallback(
    t,
    key,
    STRATEGY_DESC_FALLBACK[strategy] || STRATEGY_DESC_FALLBACK.priority || strategy
  );
}

export function getI18nOrFallback(t, key, fallback) {
  try {
    if (typeof t.has === "function" && t.has(key)) return t(key);
  } catch {}
  return fallback;
}

export function normalizeModelEntry(entry) {
  if (typeof entry === "string") return { model: entry, weight: 0 };
  if (entry?.kind === "combo-ref") {
    return {
      ...entry,
      model: entry.comboName,
      weight: entry.weight || 0,
    };
  }
  return {
    ...entry,
    model: entry.model,
    weight: entry.weight || 0,
  };
}

export function getModelString(entry) {
  if (typeof entry === "string") return entry;
  if (entry?.kind === "combo-ref") return entry.comboName;
  return entry.model;
}

export function findProviderNodeByIdentifier(providerNodes, providerIdentifier) {
  return (providerNodes || []).find(
    (node) => node.id === providerIdentifier || node.prefix === providerIdentifier
  );
}

export function findBuilderProviderByIdentifier(builderProviders, providerIdentifier) {
  return (builderProviders || []).find(
    (provider) =>
      provider.providerId === providerIdentifier ||
      provider.alias === providerIdentifier ||
      provider.prefix === providerIdentifier
  );
}

export function deriveCandidatePoolFromModels(models) {
  const providerIds = new Set<string>();

  for (const entry of models || []) {
    if (!entry) continue;
    if (entry.kind === "combo-ref") continue;
    const modelValue = getModelString(entry);
    const parsed = typeof modelValue === "string" ? parseQualifiedModel(modelValue) : null;
    const providerId =
      typeof entry.providerId === "string" && entry.providerId.trim().length > 0
        ? entry.providerId.trim()
        : parsed?.providerId;
    if (providerId) providerIds.add(providerId);
  }

  return Array.from(providerIds);
}

export function formatComboEntryDisplay(
  entry,
  {
    providerNodes = [],
    builderProviders = [],
    includeConnection = false,
    showFullEmails = true,
  }: {
    providerNodes?: any[];
    builderProviders?: any[];
    includeConnection?: boolean;
    showFullEmails?: boolean;
  } = {}
) {
  const normalizedEntry = normalizeModelEntry(entry);
  if (normalizedEntry.kind === "combo-ref") {
    return `Combo → ${normalizedEntry.comboName}`;
  }

  const parsed = parseQualifiedModel(normalizedEntry.model);
  if (!parsed) return normalizedEntry.model;

  const providerIdentifier = normalizedEntry.providerId || parsed.providerId;
  const builderProvider = findBuilderProviderByIdentifier(builderProviders, providerIdentifier);
  const providerNode = findProviderNodeByIdentifier(providerNodes, providerIdentifier);
  const providerLabel = builderProvider?.displayName || providerNode?.name || providerIdentifier;
  const modelLabel =
    builderProvider?.models?.find((model) => model.id === parsed.modelId)?.name || parsed.modelId;

  if (!includeConnection) {
    return `${providerLabel}/${modelLabel}`;
  }

  const connectionId = normalizedEntry.connectionId || null;
  const rawConnectionLabel =
    (connectionId &&
      builderProvider?.connections?.find((connection) => connection.id === connectionId)?.label) ||
    normalizedEntry.label ||
    null;
  const connectionLabel = rawConnectionLabel
    ? pickDisplayValue([rawConnectionLabel], showFullEmails, rawConnectionLabel)
    : null;

  if (connectionId) {
    return `${providerLabel}/${modelLabel} · ${connectionLabel || `acct ${connectionId.slice(0, 8)}`}`;
  }

  if (normalizedEntry.providerId || builderProvider) {
    return `${providerLabel}/${modelLabel} · dynamic account`;
  }

  return `${providerLabel}/${modelLabel}`;
}
