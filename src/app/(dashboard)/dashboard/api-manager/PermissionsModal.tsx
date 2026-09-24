"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { Button, Input, Modal } from "@/shared/components";
import { useTranslations } from "next-intl";
import { compareTr } from "@/shared/utils/turkishText";
import { ENDPOINT_CATEGORIES } from "@/shared/constants/endpointCategories";
import { mergeApiKeyPermissionScopes } from "./apiManagerScopes";
import { SELF_ACCOUNT_QUOTA_SCOPE, SELF_USAGE_SCOPE } from "@/shared/constants/selfServiceScopes";
import { hasProviderQuotaBypassScope } from "@/shared/constants/apiKeyPolicyScopes";
import { UsageLimitSettings } from "./components/UsageLimitSettings";
import { ChaosModeAccessToggle } from "./components/ChaosModeAccessToggle";
import { BypassProviderQuotaToggle } from "./components/BypassProviderQuotaToggle";
import ReasoningRoutingRules from "@/shared/components/ReasoningRoutingRules";
import {
  CLAUDE_CODE_BLOCK_PATTERN_SET,
  CLAUDE_CODE_DEFAULT_FAMILIES,
  CLAUDE_CODE_DEFAULT_MODEL_ID,
  CLAUDE_CODE_DEFAULT_MODEL_NAME,
  CLAUDE_CODE_FAMILY_BLOCK_PATTERNS,
  MAX_KEY_NAME_LENGTH,
  MAX_SELECTED_MODELS,
  getBlockedClaudeCodeFamilies,
  isClaudeCodeFamilyModel,
  toLocalDateTimeInputValue,
  validateKeyName,
} from "./apiManagerPageUtils";
import type {
  AccessSchedule,
  ApiKey,
  ClaudeCodeBlockableFamilyId,
  ComboOption,
  Model,
  ProviderConnection,
  ProviderGroup,
  StreamDefaultMode,
} from "./apiManagerPageUtils";

const PermissionsModal = memo(function PermissionsModal({
  isOpen,
  onClose,
  apiKey,
  modelsByProvider,
  allModels,
  modelsLoaded,
  allCombos,
  allConnections,
  searchModel,
  onSearchChange,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKey;
  modelsByProvider: ProviderGroup[];
  allModels: Model[];
  modelsLoaded: boolean;
  allCombos: ComboOption[];
  allConnections: ProviderConnection[];
  searchModel: string;
  onSearchChange: (v: string) => void;
  onSave: (
    name: string,
    models: string[],
    combos: string[],
    noLog: boolean,
    connections: string[],
    autoResolve: boolean,
    isActive: boolean,
    throttleDelayMs: number,
    isBanned: boolean,
    expiresAt: string | null,
    maxSessions: number,
    accessSchedule: AccessSchedule | null,
    rateLimits: Array<{ limit: number; window: number }> | null,
    scopes: string[],
    allowedEndpoints: string[],
    streamDefaultMode: StreamDefaultMode,
    disableNonPublicModels: boolean,
    allowUsageCommand: boolean,
    usageLimitEnabled: boolean,
    dailyUsageLimitUsd: number | null,
    weeklyUsageLimitUsd: number | null,
    blockedModels: string[],
    chaosModeEnabled: boolean
  ) => void;
}) {
  const t = useTranslations("apiManager");
  const tc = useTranslations("common");

  // Initialize state from props - component remounts when key prop changes
  const initialModels = Array.isArray(apiKey?.allowedModels) ? apiKey.allowedModels : [];
  const initialBlockedModels = useMemo(
    () => (Array.isArray(apiKey?.blockedModels) ? apiKey.blockedModels : []),
    [apiKey?.blockedModels]
  );
  const initialCombos = Array.isArray(apiKey?.allowedCombos) ? apiKey.allowedCombos : [];
  const initialConnections = Array.isArray(apiKey?.allowedConnections)
    ? apiKey.allowedConnections
    : [];
  const [keyName, setKeyName] = useState(apiKey?.name ?? "");
  const [selectedModels, setSelectedModels] = useState<string[]>(initialModels);
  const [blockedClaudeCodeFamilies, setBlockedClaudeCodeFamilies] = useState<
    ClaudeCodeBlockableFamilyId[]
  >(() => getBlockedClaudeCodeFamilies(initialBlockedModels));
  const [claudeCodeFamiliesExpanded, setClaudeCodeFamiliesExpanded] = useState(false);
  const [selectedCombos, setSelectedCombos] = useState<string[]>(initialCombos);
  const [allowAll, setAllowAll] = useState(initialModels.length === 0);
  const [allowAllCombos, setAllowAllCombos] = useState(initialCombos.length === 0);
  const [noLogEnabled, setNoLogEnabled] = useState(apiKey?.noLog === true);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState(apiKey?.autoResolve === true);
  const [keyIsActive, setKeyIsActive] = useState(apiKey?.isActive !== false);
  const [throttleDelayMs, setThrottleDelayMs] = useState(
    typeof apiKey?.throttleDelayMs === "number" && apiKey.throttleDelayMs > 0
      ? apiKey.throttleDelayMs
      : 0
  );
  const [keyIsBanned, setKeyIsBanned] = useState(apiKey?.isBanned === true);
  const [expiresAt, setExpiresAt] = useState(apiKey?.expiresAt ?? "");
  const [manageEnabled, setManageEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes("manage")
  );
  const [selfUsageEnabled, setSelfUsageEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(SELF_USAGE_SCOPE)
  );
  const [selfAccountQuotaEnabled, setSelfAccountQuotaEnabled] = useState(
    Array.isArray(apiKey?.scopes) && apiKey.scopes.includes(SELF_ACCOUNT_QUOTA_SCOPE)
  );
  const [bypassProviderQuotaPolicyEnabled, setBypassProviderQuotaPolicyEnabled] = useState(
    hasProviderQuotaBypassScope(apiKey?.scopes)
  );
  const [maxSessions, setMaxSessions] = useState(
    typeof apiKey?.maxSessions === "number" && apiKey.maxSessions > 0 ? apiKey.maxSessions : 0
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(apiKey?.accessSchedule?.enabled === true);
  const [scheduleFrom, setScheduleFrom] = useState(apiKey?.accessSchedule?.from ?? "08:00");
  const [scheduleUntil, setScheduleUntil] = useState(apiKey?.accessSchedule?.until ?? "18:00");
  const [scheduleDays, setScheduleDays] = useState<number[]>(
    apiKey?.accessSchedule?.days ?? [1, 2, 3, 4, 5]
  );
  const [scheduleTz, setScheduleTz] = useState(
    apiKey?.accessSchedule?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [rateLimits, setRateLimits] = useState<Array<{ limit: number; window: number }>>(
    Array.isArray(apiKey?.rateLimits) ? apiKey.rateLimits : []
  );
  const [streamDefaultMode, setStreamDefaultMode] = useState<StreamDefaultMode>(
    apiKey?.streamDefaultMode === "json" ? "json" : "legacy"
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedConnections, setSelectedConnections] = useState<string[]>(initialConnections);
  const [allowAllConnections, setAllowAllConnections] = useState(initialConnections.length === 0);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => {
    // Expand all providers by default when in restrict mode with existing selections
    if (initialModels.length > 0) {
      return new Set(modelsByProvider.map(([p]) => p));
    }
    return new Set();
  });

  const initialEndpoints = Array.isArray(apiKey?.allowedEndpoints) ? apiKey.allowedEndpoints : [];
  const [selectedEndpoints, setSelectedEndpoints] = useState<string[]>(initialEndpoints);
  const [allowAllEndpoints, setAllowAllEndpoints] = useState(initialEndpoints.length === 0);
  const [disableNonPublicModels, setDisableNonPublicModels] = useState(
    apiKey?.disableNonPublicModels === true
  );
  const [usageCommandEnabled, setUsageCommandEnabled] = useState(
    apiKey?.allowUsageCommand === true
  );
  const [chaosModeEnabled, setChaosModeEnabled] = useState(apiKey?.chaosModeEnabled === true);
  const [usageLimitEnabled, setUsageLimitEnabled] = useState(apiKey?.usageLimitEnabled === true);
  const [dailyUsageLimitUsd, setDailyUsageLimitUsd] = useState(
    typeof apiKey?.dailyUsageLimitUsd === "number" && apiKey.dailyUsageLimitUsd > 0
      ? String(apiKey.dailyUsageLimitUsd)
      : ""
  );
  const [weeklyUsageLimitUsd, setWeeklyUsageLimitUsd] = useState(
    typeof apiKey?.weeklyUsageLimitUsd === "number" && apiKey.weeklyUsageLimitUsd > 0
      ? String(apiKey.weeklyUsageLimitUsd)
      : ""
  );
  const getModelDisplayName = useCallback(
    (modelId: string) =>
      modelId === CLAUDE_CODE_DEFAULT_MODEL_ID ? CLAUDE_CODE_DEFAULT_MODEL_NAME : modelId,
    []
  );

  // Memoize callbacks to prevent child re-renders
  const handleToggleModel = useCallback(
    (modelId: string) => {
      if (allowAll) return;

      setSelectedModels((prev) => {
        if (prev.includes(modelId)) {
          if (modelId === CLAUDE_CODE_DEFAULT_MODEL_ID) {
            setClaudeCodeFamiliesExpanded(false);
          }
          return prev.filter((m) => m !== modelId);
        }
        return [...prev, modelId];
      });
    },
    [allowAll]
  );

  const handleToggleProvider = useCallback(
    (provider: string, models: Model[]) => {
      if (allowAll) return;

      const modelIds = models.map((m) => m.id);
      setSelectedModels((prev) => {
        const allSelected = modelIds.every((id) => prev.includes(id));
        if (allSelected) {
          return prev.filter((m) => !modelIds.includes(m));
        }
        return [...new Set([...prev, ...modelIds])];
      });
    },
    [allowAll]
  );

  const handleSelectAll = useCallback(() => {
    setAllowAll(true);
    setSelectedModels([]);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, []);

  const handleRestrictMode = useCallback(() => {
    setAllowAll(false);
    // Expand all providers when entering restrict mode
    const allProviders = new Set(modelsByProvider.map(([p]) => p));
    setExpandedProviders(allProviders);
  }, [modelsByProvider]);

  const handleToggleExpand = useCallback((provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  const handleSelectAllModels = useCallback(() => {
    const allModelIds = allModels.map((m) => m.id);
    setSelectedModels(allModelIds);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, [allModels]);

  const handleDeselectAllModels = useCallback(() => {
    setSelectedModels([]);
    setBlockedClaudeCodeFamilies([]);
    setClaudeCodeFamiliesExpanded(false);
  }, []);

  const handleBlockClaudeCodeFamily = useCallback((familyId: ClaudeCodeBlockableFamilyId) => {
    setBlockedClaudeCodeFamilies((prev) => (prev.includes(familyId) ? prev : [...prev, familyId]));
    setSelectedModels((prev) =>
      prev.filter((modelId) => !isClaudeCodeFamilyModel(modelId, familyId))
    );
  }, []);

  const handleToggleCombo = useCallback(
    (comboName: string) => {
      if (allowAllCombos) return;
      setSelectedCombos((prev) =>
        prev.includes(comboName) ? prev.filter((name) => name !== comboName) : [...prev, comboName]
      );
    },
    [allowAllCombos]
  );

  const handleToggleConnection = useCallback(
    (connectionId: string) => {
      if (allowAllConnections) return;
      setSelectedConnections((prev) =>
        prev.includes(connectionId)
          ? prev.filter((c) => c !== connectionId)
          : [...prev, connectionId]
      );
    },
    [allowAllConnections]
  );

  const handleToggleEndpoint = useCallback(
    (categoryId: string) => {
      if (allowAllEndpoints) return;
      setSelectedEndpoints((prev) =>
        prev.includes(categoryId) ? prev.filter((e) => e !== categoryId) : [...prev, categoryId]
      );
    },
    [allowAllEndpoints]
  );

  const parseUsdLimitInput = useCallback((value: string): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const handleSave = useCallback(() => {
    // Clear previous inline errors
    setNameError(null);
    setSaveError(null);

    // Validate name inline before calling onSave
    const validation = validateKeyName(keyName, t);
    if (!validation.valid) {
      setNameError(validation.error || t("invalidKeyName"));
      return;
    }

    // Validate models selection
    if (!allowAll && !Array.isArray(selectedModels)) {
      setSaveError(t("invalidModelsSelection"));
      return;
    }

    // Limit number of selected models to prevent abuse
    if (!allowAll && selectedModels.length > MAX_SELECTED_MODELS) {
      setSaveError(t("cannotSelectMoreThanModels", { max: MAX_SELECTED_MODELS }));
      return;
    }

    const schedule: AccessSchedule | null = scheduleEnabled
      ? {
          enabled: true,
          from: scheduleFrom,
          until: scheduleUntil,
          days: scheduleDays,
          tz: scheduleTz,
        }
      : null;
    const hasClaudeCodeDefaultSelected =
      !allowAll && selectedModels.includes(CLAUDE_CODE_DEFAULT_MODEL_ID);
    const blockedModels = initialBlockedModels.filter(
      (pattern) => !CLAUDE_CODE_BLOCK_PATTERN_SET.has(pattern)
    );
    if (hasClaudeCodeDefaultSelected) {
      for (const familyId of blockedClaudeCodeFamilies) {
        blockedModels.push(...CLAUDE_CODE_FAMILY_BLOCK_PATTERNS[familyId]);
      }
    }
    onSave(
      keyName,
      allowAll ? [] : selectedModels,
      allowAllCombos ? [] : selectedCombos,
      noLogEnabled,
      allowAllConnections ? [] : selectedConnections,
      autoResolveEnabled,
      keyIsActive,
      throttleDelayMs,
      keyIsBanned,
      expiresAt || null,
      maxSessions,
      schedule,
      rateLimits.length > 0 ? rateLimits : null,
      mergeApiKeyPermissionScopes(apiKey?.scopes, {
        manageEnabled,
        selfUsageEnabled,
        selfAccountQuotaEnabled,
        bypassProviderQuotaPolicyEnabled,
      }),
      allowAllEndpoints ? [] : selectedEndpoints,
      streamDefaultMode,
      disableNonPublicModels,
      usageCommandEnabled,
      usageLimitEnabled,
      parseUsdLimitInput(dailyUsageLimitUsd),
      parseUsdLimitInput(weeklyUsageLimitUsd),
      blockedModels,
      chaosModeEnabled
    );
  }, [
    onSave,
    keyName,
    allowAll,
    selectedModels,
    allowAllCombos,
    selectedCombos,
    noLogEnabled,
    allowAllConnections,
    selectedConnections,
    autoResolveEnabled,
    keyIsActive,
    throttleDelayMs,
    keyIsBanned,
    expiresAt,
    maxSessions,
    manageEnabled,
    selfUsageEnabled,
    selfAccountQuotaEnabled,
    bypassProviderQuotaPolicyEnabled,
    scheduleEnabled,
    scheduleFrom,
    scheduleUntil,
    scheduleDays,
    scheduleTz,
    rateLimits,
    allowAllEndpoints,
    selectedEndpoints,
    streamDefaultMode,
    disableNonPublicModels,
    usageCommandEnabled,
    usageLimitEnabled,
    dailyUsageLimitUsd,
    weeklyUsageLimitUsd,
    parseUsdLimitInput,
    blockedClaudeCodeFamilies,
    initialBlockedModels,
    chaosModeEnabled,
    apiKey?.scopes,
    t,
  ]);

  const selectedCount = selectedModels.length;
  const totalModels = allModels.length;
  const hasClaudeCodeDefaultSelected =
    !allowAll && selectedModels.includes(CLAUDE_CODE_DEFAULT_MODEL_ID);
  const orderedSelectedModels = useMemo(() => {
    if (!hasClaudeCodeDefaultSelected) return selectedModels;
    return [
      CLAUDE_CODE_DEFAULT_MODEL_ID,
      ...selectedModels.filter((modelId) => modelId !== CLAUDE_CODE_DEFAULT_MODEL_ID),
    ];
  }, [hasClaudeCodeDefaultSelected, selectedModels]);
  const visibleClaudeCodeFamilies = useMemo(
    () =>
      CLAUDE_CODE_DEFAULT_FAMILIES.filter(
        (family) =>
          family.id === "other" ||
          !blockedClaudeCodeFamilies.includes(family.id as ClaudeCodeBlockableFamilyId)
      ),
    [blockedClaudeCodeFamilies]
  );

  return (
    <Modal
      isOpen={onClose ? isOpen : false}
      title={t("permissionsTitle", { name: apiKey?.name || "" })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {/* Key Name */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("keyName")}</p>
            <p className="text-xs text-text-muted">{t("keyNameDesc")}</p>
          </div>
          <div className="w-48 shrink-0">
            <Input
              value={keyName}
              onChange={(e) => {
                setKeyName(e.target.value);
                setNameError(null);
              }}
              placeholder={t("keyNamePlaceholder")}
              maxLength={MAX_KEY_NAME_LENGTH}
              error={nameError}
            />
          </div>
        </div>

        {/* Inline save error */}
        {saveError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <span className="material-symbols-outlined text-red-500 text-sm">error</span>
            <p className="text-sm text-red-700 dark:text-red-300 flex-1">{saveError}</p>
          </div>
        )}

        {apiKey?.id && <ReasoningRoutingRules apiKeyId={apiKey.id} />}

        {/* Access Mode Toggle */}
        <div className="flex gap-2 p-1 bg-surface rounded-lg">
          <button
            onClick={handleSelectAll}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              allowAll
                ? "bg-primary text-white"
                : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">lock_open</span>
            {t("allowAll")}
          </button>
          <button
            onClick={handleRestrictMode}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
              !allowAll
                ? "bg-primary text-white"
                : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">lock</span>
            {t("restrict")}
          </button>
        </div>

        {/* Info Banner */}
        <div
          className={`flex items-start gap-2 p-3 rounded-lg ${
            allowAll
              ? "bg-green-500/10 border border-green-500/30"
              : "bg-amber-500/10 border border-amber-500/30"
          }`}
        >
          <span
            className={`material-symbols-outlined text-[18px] ${
              allowAll ? "text-green-500" : "text-amber-500"
            }`}
          >
            {allowAll ? "info" : "warning"}
          </span>
          <p
            className={`text-xs ${
              allowAll ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {allowAll
              ? t("allowAllDesc")
              : !modelsLoaded
                ? t("restrictLoading")
                : totalModels === 0
                  ? t("restrictCatalogUnavailable", { selectedCount })
                  : t("restrictDesc", { selectedCount, totalModels })}
          </p>
        </div>

        {/* Key Active Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("keyActive")}</p>
            <p className="text-xs text-text-muted">{t("keyActiveDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={keyIsActive}
            onClick={() => setKeyIsActive((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              keyIsActive
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {keyIsActive ? "check_circle" : "block"}
            </span>
            {keyIsActive ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Max Sessions Limit (T08) */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("maxActiveSessions")}</p>
            <p className="text-xs text-text-muted">{t("maxActiveSessionsDescription")}</p>
          </div>
          <div className="w-32">
            <Input
              type="number"
              min={0}
              step={1}
              value={String(maxSessions)}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || "0", 10);
                setMaxSessions(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
              }}
            />
          </div>
        </div>

        {/* Soft Throttle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("throttleDelay")}</p>
            <p className="text-xs text-text-muted">{t("throttleDelayDescription")}</p>
          </div>
          <div className="w-36">
            <Input
              type="number"
              min={0}
              max={300000}
              step={100}
              value={String(throttleDelayMs)}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || "0", 10);
                setThrottleDelayMs(
                  Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300000) : 0
                );
              }}
            />
            <p className="text-[10px] text-text-muted mt-1">milliseconds</p>
          </div>
        </div>

        {/* Custom Rate Limits */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-main">
                {t("apiManagerCustomRateLimits")}
              </p>
              <p className="text-xs text-text-muted">{t("apiManagerCustomRateLimitsDesc")}</p>
            </div>
            <button
              type="button"
              onClick={() => setRateLimits((prev) => [...prev, { limit: 100, window: 60 }])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add Limit
            </button>
          </div>
          {rateLimits.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              {rateLimits.map((rl, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={String(rl.limit)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRateLimits((prev) => {
                        const next = [...prev];
                        next[index].limit = val;
                        return next;
                      });
                    }}
                    placeholder={t("apiManagerRateLimitRequestsPlaceholder")}
                  />
                  <span className="text-sm text-text-muted shrink-0">
                    {t("apiManagerRateLimitReqPer")}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={String(rl.window)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRateLimits((prev) => {
                        const next = [...prev];
                        next[index].window = val;
                        return next;
                      });
                    }}
                    placeholder={t("apiManagerRateLimitSecondsPlaceholder")}
                  />
                  <span className="text-sm text-text-muted shrink-0">sec</span>
                  <button
                    type="button"
                    onClick={() => setRateLimits((prev) => prev.filter((_, i) => i !== index))}
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded transition-colors shrink-0"
                    title={t("apiManagerRemoveLimitTitle")}
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Access Schedule */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-main">{t("accessSchedule")}</p>
              <p className="text-xs text-text-muted">{t("accessScheduleDesc")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={scheduleEnabled}
              onClick={() => setScheduleEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors shrink-0 ${
                scheduleEnabled
                  ? "bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30"
                  : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              {scheduleEnabled ? tc("enabled") : tc("disabled")}
            </button>
          </div>
          {scheduleEnabled && (
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t("scheduleFrom")}</label>
                  <input
                    type="time"
                    value={scheduleFrom}
                    onChange={(e) => setScheduleFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t("scheduleUntil")}</label>
                  <input
                    type="time"
                    value={scheduleUntil}
                    onChange={(e) => setScheduleUntil(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1.5 block">{t("scheduleDays")}</label>
                <div className="flex gap-1 flex-wrap">
                  {(
                    [
                      [0, t("daySun")],
                      [1, t("dayMon")],
                      [2, t("dayTue")],
                      [3, t("dayWed")],
                      [4, t("dayThu")],
                      [5, t("dayFri")],
                      [6, t("daySat")],
                    ] as [number, string][]
                  ).map(([dayIdx, label]) => {
                    const selected = scheduleDays.includes(dayIdx);
                    return (
                      <button
                        key={dayIdx}
                        type="button"
                        onClick={() =>
                          setScheduleDays((prev) =>
                            prev.includes(dayIdx)
                              ? prev.filter((d) => d !== dayIdx)
                              : [...prev, dayIdx].sort((a, b) => a - b)
                          )
                        }
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${
                          selected
                            ? "bg-primary text-white"
                            : "bg-surface border border-border text-text-muted hover:border-primary/50"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">
                  {t("scheduleTimezone")}
                </label>
                <input
                  type="text"
                  value={scheduleTz}
                  onChange={(e) => setScheduleTz(e.target.value)}
                  placeholder={t("apiManagerTimezonePlaceholder")}
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main font-mono"
                />
                <p className="text-[10px] text-text-muted mt-1">{t("scheduleTimezoneHint")}</p>
              </div>
            </div>
          )}
        </div>

        {/* Privacy Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("noLogPayloadPrivacy")}</p>
            <p className="text-xs text-text-muted">
              Disable request/response payload persistence for this API key.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={noLogEnabled}
            onClick={() => setNoLogEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              noLogEnabled
                ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {noLogEnabled ? "visibility_off" : "visibility"}
            </span>
            {noLogEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Auto-Resolve Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("autoResolve")}</p>
            <p className="text-xs text-text-muted">{t("autoResolveDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoResolveEnabled}
            onClick={() => setAutoResolveEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              autoResolveEnabled
                ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {autoResolveEnabled ? "auto_fix_high" : "auto_fix_normal"}
            </span>
            {autoResolveEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>

        {/* Stream Default Compatibility */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm font-medium text-text-main">{t("streamDefaultMode")}</p>
            <p className="text-xs text-text-muted">{t("streamDefaultModeDesc")}</p>
          </div>
          <div className="flex gap-1 p-0.5 bg-surface rounded-md shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setStreamDefaultMode("legacy")}
              className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                streamDefaultMode === "legacy"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">settings_backup_restore</span>
              {t("streamDefaultLegacy")}
            </button>
            <button
              type="button"
              onClick={() => setStreamDefaultMode("json")}
              className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                streamDefaultMode === "json"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">data_object</span>
              {t("streamDefaultJson")}
            </button>
          </div>
        </div>

        {/* Ban Toggle (SECURITY) */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{t("bannedStatus")}</p>
            <p className="text-xs text-red-600 dark:text-red-300">
              Immediately revoke all access. Used for suspected abuse or compromised keys.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={keyIsBanned}
            onClick={() => setKeyIsBanned((prev) => !prev)}
            className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
              keyIsBanned
                ? "bg-red-500 text-white shadow-sm"
                : "bg-black/5 dark:bg-white/5 text-text-muted hover:bg-black/10 dark:hover:bg-white/10"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {keyIsBanned ? "block" : "check_circle"}
            </span>
            {keyIsBanned ? "Banned" : "Active"}
          </button>
        </div>
        {/* Expiration Date */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("expirationDate")}</p>
            <p className="text-xs text-text-muted">
              Key will automatically stop working after this date.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={toLocalDateTimeInputValue(expiresAt)}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  setExpiresAt("");
                  return;
                }
                const date = new Date(val);
                if (!Number.isNaN(date.getTime())) {
                  setExpiresAt(date.toISOString());
                }
              }}
              className="min-w-0 flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-text-main"
            />
            <button
              type="button"
              onClick={() => setExpiresAt("")}
              disabled={!expiresAt}
              className="shrink-0 px-3 py-1.5 text-sm font-medium border border-border rounded-md text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              {tc("clear")}
            </button>
          </div>
        </div>
        {/* Management Access */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("managementAccess")}</p>
            <p className="text-xs text-text-muted">{t("managementAccessDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={manageEnabled}
            onClick={() => setManageEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              manageEnabled
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
            {manageEnabled ? tc("enabled") : tc("disabled")}
          </button>
        </div>
        {/* Self-service Visibility */}
        <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("selfServiceVisibility")}</p>
            <p className="text-xs text-text-muted">{t("selfServiceVisibilityDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={selfUsageEnabled}
            onClick={() =>
              setSelfUsageEnabled((prev) => {
                if (prev) setSelfAccountQuotaEnabled(false);
                return !prev;
              })
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              selfUsageEnabled
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">query_stats</span>
            {t("ownUsageVisibility")} - {selfUsageEnabled ? tc("enabled") : tc("disabled")}
          </button>
          <p className="text-xs text-text-muted">{t("ownUsageVisibilityDesc")}</p>
          <button
            type="button"
            role="switch"
            aria-checked={selfAccountQuotaEnabled}
            disabled={!selfUsageEnabled}
            onClick={() => setSelfAccountQuotaEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              selfAccountQuotaEnabled
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            } ${!selfUsageEnabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="material-symbols-outlined text-[14px]">account_balance</span>
            {t("sharedAccountQuotaVisibility")} -{" "}
            {selfAccountQuotaEnabled ? tc("enabled") : tc("disabled")}
          </button>
          <p className="text-xs text-text-muted">{t("sharedAccountQuotaVisibilityDesc")}</p>
          <button
            type="button"
            role="switch"
            aria-checked={usageCommandEnabled}
            onClick={() => setUsageCommandEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              usageCommandEnabled
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">terminal</span>
            {t("localUsageCommand")} - {usageCommandEnabled ? tc("enabled") : tc("disabled")}
          </button>
          <p className="text-xs text-text-muted">{t("localUsageCommandDesc")}</p>
          <UsageLimitSettings
            enabled={usageLimitEnabled}
            dailyLimitUsd={dailyUsageLimitUsd}
            weeklyLimitUsd={weeklyUsageLimitUsd}
            enabledLabel={tc("enabled")}
            disabledLabel={tc("disabled")}
            onEnabledChange={setUsageLimitEnabled}
            onDailyLimitUsdChange={setDailyUsageLimitUsd}
            onWeeklyLimitUsdChange={setWeeklyUsageLimitUsd}
          />
        </div>

        {/* Chaos Mode Access Toggle */}
        <ChaosModeAccessToggle
          enabled={chaosModeEnabled}
          onToggle={() => setChaosModeEnabled((prev) => !prev)}
        />

        {/* Advanced Provider Quota Policy Override */}
        <BypassProviderQuotaToggle
          enabled={bypassProviderQuotaPolicyEnabled}
          onToggle={() => setBypassProviderQuotaPolicyEnabled((prev) => !prev)}
        />

        {/* Disable Non-Public Models Toggle */}
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text-main">{t("disableNonPublicModels")}</p>
            <p className="text-xs text-text-muted">{t("disableNonPublicModelsDesc")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={disableNonPublicModels}
            onClick={() => setDisableNonPublicModels((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              disableNonPublicModels
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                : "bg-black/5 dark:bg-white/5 text-text-muted border border-border"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {disableNonPublicModels ? "shield_lock" : "shield"}
            </span>
            {disableNonPublicModels ? tc("yes") : tc("no")}
          </button>
        </div>

        {/* Selected Models Summary (only in restrict mode) */}
        {!allowAll && selectedCount > 0 && (
          <div className="flex flex-col gap-1.5 p-2 bg-primary/5 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">
                {t("selectedCount", { count: selectedCount })}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAllModels}
                  className="text-[10px] text-primary hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors"
                >
                  {tc("all")}
                </button>
                <button
                  onClick={handleDeselectAllModels}
                  className="text-[10px] text-red-500 hover:bg-red-500/10 px-1.5 py-0.5 rounded transition-colors"
                >
                  {t("clear")}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto content-start">
              {orderedSelectedModels.map((modelId) => {
                if (modelId === CLAUDE_CODE_DEFAULT_MODEL_ID) {
                  return (
                    <div key={modelId} className="flex flex-col gap-1 basis-full">
                      <span className="inline-flex w-fit items-center gap-0.5 px-1.5 py-0.5 bg-primary/10 text-text-main text-[10px] rounded border border-primary/35">
                        <button
                          type="button"
                          onClick={() => setClaudeCodeFamiliesExpanded((prev) => !prev)}
                          className="inline-flex items-center gap-1 font-mono text-text-main"
                          title={t("expandClaudeCodeFamilies")}
                          aria-expanded={claudeCodeFamiliesExpanded}
                        >
                          <span className="truncate max-w-[140px]" title={modelId}>
                            {getModelDisplayName(modelId)}
                          </span>
                          <span className="material-symbols-outlined text-[12px] text-primary">
                            {claudeCodeFamiliesExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleModel(modelId)}
                          className="text-text-muted hover:text-red-500 transition-colors"
                          title={t("removeClaudeCodeDefault")}
                        >
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </span>

                      {claudeCodeFamiliesExpanded && (
                        <div className="relative ml-2 flex flex-wrap gap-1 pl-5 animate-in fade-in slide-in-from-top-1 duration-150">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-1.5 top-0 bottom-1 w-px bg-primary/25"
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-1.5 top-3 h-px w-3 bg-primary/25"
                          />
                          {visibleClaudeCodeFamilies.map((family) => {
                            const canBlock = family.id !== "other";
                            return (
                              <span
                                key={family.id}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border ${
                                  canBlock
                                    ? "bg-white dark:bg-surface text-text-main border-border"
                                    : "bg-black/5 dark:bg-white/5 text-text-muted border-border"
                                }`}
                                title={
                                  canBlock
                                    ? `Allow ${family.label} family through Claude Code default`
                                    : "Catch-all for other Claude Code models"
                                }
                              >
                                <span className="font-mono">{family.label}</span>
                                {canBlock && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleBlockClaudeCodeFamily(
                                        family.id as ClaudeCodeBlockableFamilyId
                                      )
                                    }
                                    className="text-text-muted hover:text-red-500 transition-colors"
                                    title={`Block ${family.label} family`}
                                  >
                                    <span className="material-symbols-outlined text-[12px]">
                                      close
                                    </span>
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <span
                    key={modelId}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white dark:bg-surface text-text-main text-[10px] rounded border border-border"
                  >
                    <span className="font-mono truncate max-w-[120px]" title={modelId}>
                      {getModelDisplayName(modelId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleModel(modelId)}
                      className="text-text-muted hover:text-red-500 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Search and Model Selection (only in restrict mode) */}
        {!allowAll && (
          <>
            <div className="relative">
              <Input
                value={searchModel}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("searchModels")}
                icon="search"
              />
              {searchModel && (
                <button
                  onClick={() => onSearchChange("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              )}
            </div>

            <div className="max-h-[280px] overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {modelsByProvider.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-text-muted">
                  <span className="material-symbols-outlined text-2xl mb-1">search_off</span>
                  <p className="text-xs">{t("noModelsFound")}</p>
                </div>
              ) : (
                modelsByProvider.map(([provider, models]) => {
                  const selectedInProvider = selectedModels.filter((m) =>
                    models.some((model) => model.id === m)
                  ).length;
                  const allSelected = models.every((m) => selectedModels.includes(m.id));
                  const someSelected = selectedInProvider > 0 && !allSelected;

                  return (
                    <div key={provider} className="group">
                      <button
                        onClick={() => handleToggleExpand(provider)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface/50 transition-colors text-left"
                      >
                        <span
                          className={`material-symbols-outlined text-base transition-transform duration-200 ${
                            expandedProviders.has(provider) ? "rotate-90" : ""
                          }`}
                        >
                          chevron_right
                        </span>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div
                            className="relative flex items-center cursor-pointer shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleProvider(provider, models);
                            }}
                          >
                            <div
                              className={`w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${
                                allSelected
                                  ? "bg-primary border-primary"
                                  : someSelected
                                    ? "bg-primary/20 border-primary"
                                    : "border-border hover:border-primary/50"
                              }`}
                            >
                              {allSelected && (
                                <span className="material-symbols-outlined text-white text-[12px]">
                                  check
                                </span>
                              )}
                              {someSelected && !allSelected && (
                                <span className="material-symbols-outlined text-primary text-[12px]">
                                  remove
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-text-main truncate">
                            {provider}
                          </span>
                          <span className="text-[10px] text-text-muted bg-surface px-1 py-0.5 rounded shrink-0">
                            {models.length}
                          </span>
                        </div>
                        {selectedInProvider > 0 && (
                          <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                            {selectedInProvider}
                          </span>
                        )}
                      </button>

                      {/* Expandable model list */}
                      {expandedProviders.has(provider) && (
                        <div className="px-3 pb-2 pl-9">
                          <div className="flex flex-wrap gap-1">
                            {models.map((model) => {
                              const isSelected = selectedModels.includes(model.id);
                              return (
                                <button
                                  key={model.id}
                                  onClick={() => handleToggleModel(model.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono transition-all ${
                                    isSelected
                                      ? "bg-primary text-white"
                                      : "bg-surface border border-border text-text-muted hover:border-primary/50 hover:text-text-main"
                                  }`}
                                  title={model.id}
                                >
                                  {getModelDisplayName(model.id)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Allowed Connections Section */}
        {allConnections.length > 0 && (
          <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-main">{t("allowedConnections")}</p>
              <div className="flex gap-1 p-0.5 bg-surface rounded-md">
                <button
                  onClick={() => {
                    setAllowAllConnections(true);
                    setSelectedConnections([]);
                  }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    allowAllConnections
                      ? "bg-primary text-white"
                      : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setAllowAllConnections(false)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    !allowAllConnections
                      ? "bg-primary text-white"
                      : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  Restrict
                </button>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              {allowAllConnections
                ? "This key can use any active connection."
                : `Restricted to ${selectedConnections.length} connection${selectedConnections.length !== 1 ? "s" : ""}.`}
            </p>
            {!allowAllConnections && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {Object.entries(
                  allConnections.reduce<Record<string, ProviderConnection[]>>((acc, conn) => {
                    const p = conn.provider || "Other";
                    if (!acc[p]) acc[p] = [];
                    acc[p].push(conn);
                    return acc;
                  }, {})
                )
                  .sort(([a], [b]) => compareTr(a, b))
                  .map(([provider, conns]) => (
                    <div key={provider}>
                      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1 py-0.5">
                        {provider}
                      </p>
                      {conns.map((conn) => {
                        const isSelected = selectedConnections.includes(conn.id);
                        return (
                          <button
                            key={conn.id}
                            onClick={() => handleToggleConnection(conn.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                              isSelected
                                ? "bg-primary/10 text-primary"
                                : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                isSelected ? "bg-primary border-primary" : "border-border"
                              }`}
                            >
                              {isSelected && (
                                <span className="material-symbols-outlined text-white text-[10px]">
                                  check
                                </span>
                              )}
                            </div>
                            <span className="truncate flex-1">
                              {conn.name || conn.id.slice(0, 8)}
                            </span>
                            {!conn.isActive && (
                              <span className="text-[9px] text-red-400 shrink-0">
                                {tc("inactive")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Allowed Combos Section */}
        {allCombos.length > 0 && (
          <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-main">{t("allowedCombos")}</p>
              <div className="flex gap-1 p-0.5 bg-surface rounded-md">
                <button
                  onClick={() => {
                    setAllowAllCombos(true);
                    setSelectedCombos([]);
                  }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    allowAllCombos
                      ? "bg-primary text-white"
                      : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {tc("all")}
                </button>
                <button
                  onClick={() => setAllowAllCombos(false)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    !allowAllCombos
                      ? "bg-primary text-white"
                      : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {t("restrict")}
                </button>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              {allowAllCombos
                ? t("allCombosAllowed")
                : t("restrictedComboCount", { count: selectedCombos.length })}
            </p>
            {!allowAllCombos && (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {allCombos
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((combo) => {
                    const isSelected = selectedCombos.includes(combo.name);
                    return (
                      <button
                        key={combo.id || combo.name}
                        onClick={() => handleToggleCombo(combo.name)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                        }`}
                      >
                        <div
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-primary border-primary" : "border-border"
                          }`}
                        >
                          {isSelected && (
                            <span className="material-symbols-outlined text-white text-[10px]">
                              check
                            </span>
                          )}
                        </div>
                        <span className="truncate flex-1">{combo.name}</span>
                        {Array.isArray(combo.models) && (
                          <span className="text-[10px] text-text-muted shrink-0">
                            {combo.models.length} models
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Allowed Endpoints Section */}
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/40">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-main">{t("endpointRestrictions")}</p>
              <p className="text-xs text-text-muted">
                {allowAllEndpoints
                  ? t("allEndpointsAllowed")
                  : t("endpointsRestricted", {
                      count: selectedEndpoints.length,
                    })}
              </p>
            </div>
            <div className="flex gap-1 p-0.5 bg-surface rounded-md">
              <button
                onClick={() => {
                  setAllowAllEndpoints(true);
                  setSelectedEndpoints([]);
                }}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  allowAllEndpoints
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {t("all")}
              </button>
              <button
                onClick={() => setAllowAllEndpoints(false)}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                  !allowAllEndpoints
                    ? "bg-primary text-white"
                    : "text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {t("restrict")}
              </button>
            </div>
          </div>
          {!allowAllEndpoints && (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {ENDPOINT_CATEGORIES.map((cat) => {
                const isSelected = selectedEndpoints.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleToggleEndpoint(cat.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-primary border-primary" : "border-border"
                      }`}
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-white text-[10px]">
                          check
                        </span>
                      )}
                    </div>
                    <span className="truncate flex-1">{cat.label}</span>
                    <span className="text-[10px] text-text-muted shrink-0 truncate max-w-[140px]">
                      {cat.description}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth>
            {t("savePermissions")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {tc("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
});

export default PermissionsModal;
