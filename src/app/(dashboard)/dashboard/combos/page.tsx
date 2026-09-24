"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components/Loading";
import EmptyState from "@/shared/components/EmptyState";
import Input from "@/shared/components/Input";
import Modal from "@/shared/components/Modal";
import Toggle from "@/shared/components/Toggle";
import Tooltip from "@/shared/components/Tooltip";
import { ComboCompressionModeSelect } from "@/shared/components/compression/ComboCompressionModeSelect";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { FieldLabelWithHelp, WeightTotalBar } from "./parts";
import { useComboProxyAssignments } from "./useComboProxyAssignments";
import { ResponseValidationEditor, type ResponseValidationValue } from "./ResponseValidationEditor";
import ReasoningTokenBufferToggle from "./ReasoningTokenBufferToggle";
import { useNotificationStore } from "@/store/notificationStore";
import { ROUTING_STRATEGIES } from "@/shared/constants/routingStrategies";
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
  isEligibleActiveConnection,
  isIntelligentBuilderStrategy,
  parseQualifiedModel,
  resolveComboBuilderProviderId,
} from "@/lib/combos/builderDraft";
import { normalizeComboConfigMode } from "@/shared/constants/comboConfigMode";
import AutoComboCatalog from "./AutoComboCatalog";
import KimiComboPresetCard from "./KimiComboPresetCard";
import { KIMI_CODING_PRESET, hasKimiCodingPreset } from "./kimiComboPreset";
import IntelligentComboPanel from "./IntelligentComboPanel";
import {
  filterCombosByStrategyCategory,
  getStrategyCategory,
  isIntelligentStrategy,
  normalizeIntelligentRoutingFilter,
} from "@/lib/combos/intelligentRouting";
import { resolveServerErrorMessage } from "@/lib/api/serverErrorMessage";
import { useTranslations } from "next-intl";
import {
  formatComboEntryDisplay,
  getI18nOrFallback,
  getStrategyDescription,
  getStrategyLabel,
  normalizeModelEntry,
  sanitizeComboRuntimeConfig,
} from "./comboFormUtils";

const ModelSelectModal = dynamic(() => import("@/shared/components/ModelSelectModal"), {
  ssr: false,
});
const ProxyConfigModal = dynamic(() => import("@/shared/components/ProxyConfigModal"), {
  ssr: false,
});
const ComboFormModal = dynamic(() => import("./ComboFormModal"), { ssr: false });

const COMBO_USAGE_GUIDE_STORAGE_KEY = "omniroute:combos:hide-usage-guide";

function getStrategyBadgeClass(strategy) {
  if (strategy === "weighted") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (strategy === "round-robin") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (strategy === "context-relay")
    return "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400";
  if (strategy === "random") return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
  if (strategy === "least-used") return "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400";
  if (strategy === "cost-optimized") return "bg-teal-500/15 text-teal-600 dark:text-teal-400";
  if (strategy === "reset-aware") return "bg-lime-500/15 text-lime-700 dark:text-lime-300";
  if (strategy === "fill-first") return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
  if (strategy === "p2c") return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400";
  return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
}

function moveArrayItem(items, fromIndex, toIndex) {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export default function CombosPage() {
  const t = useTranslations("combos");
  const tc = useTranslations("common");
  const emailsVisible = useEmailPrivacyStore((s) => s.emailsVisible);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [testResults, setTestResults] = useState(null);
  const [testingCombo, setTestingCombo] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  const notify = useNotificationStore();
  const [proxyTargetCombo, setProxyTargetCombo] = useState(null);
  const [proxyConfig, setProxyConfig] = useState(null);
  const { comboProxyAssignedIds, fetchComboProxyAssignments } = useComboProxyAssignments();
  const [providerNodes, setProviderNodes] = useState([]);
  const [showUsageGuide, setShowUsageGuide] = useState(true);
  const [recentlyCreatedCombo, setRecentlyCreatedCombo] = useState("");
  const [creatingKimiPreset, setCreatingKimiPreset] = useState(false);
  const [comboDragIndex, setComboDragIndex] = useState(null);
  const [comboDragOverIndex, setComboDragOverIndex] = useState(null);
  const [savingComboOrder, setSavingComboOrder] = useState(false);
  const [comboConfigMode, setComboConfigMode] = useState("guided");
  const [promptCompressionEnabled, setPromptCompressionEnabled] = useState(false);
  const [selectedIntelligentComboId, setSelectedIntelligentComboId] = useState<string | null>(null);
  const comboDragIndexRef = useRef<number | null>(null);
  const activeFilter = normalizeIntelligentRoutingFilter(searchParams.get("filter"));
  const intelligentCombos = useMemo(
    () => combos.filter((combo) => isIntelligentStrategy(combo?.strategy)),
    [combos]
  );
  const filteredCombos = useMemo(
    () => filterCombosByStrategyCategory(combos, activeFilter),
    [combos, activeFilter]
  );
  const selectedIntelligentCombo = useMemo(() => {
    if (intelligentCombos.length === 0) return null;

    const explicitlySelectedCombo =
      intelligentCombos.find((combo) => combo.id === selectedIntelligentComboId) || null;

    if (explicitlySelectedCombo) {
      return explicitlySelectedCombo;
    }

    return activeFilter === "intelligent" ? intelligentCombos[0] : null;
  }, [activeFilter, intelligentCombos, selectedIntelligentComboId]);

  useEffect(() => {
    if (intelligentCombos.length === 0) {
      setSelectedIntelligentComboId(null);
      return;
    }

    if (
      selectedIntelligentComboId &&
      !intelligentCombos.some((combo) => combo.id === selectedIntelligentComboId)
    ) {
      setSelectedIntelligentComboId(null);
    }
  }, [intelligentCombos, selectedIntelligentComboId]);

  useEffect(() => {
    fetchData();
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((settings) => setComboConfigMode(normalizeComboConfigMode(settings?.comboConfigMode)))
      .catch(() => setComboConfigMode("guided"));
    fetch("/api/settings/compression")
      .then((r) => (r.ok ? r.json() : null))
      .then((settings) => setPromptCompressionEnabled(settings?.enabled === true))
      .catch(() => setPromptCompressionEnabled(false));
    fetch("/api/settings/proxy")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setProxyConfig(c))
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      if (globalThis.localStorage?.getItem(COMBO_USAGE_GUIDE_STORAGE_KEY) === "1") {
        setShowUsageGuide(false);
      }
    } catch {
      // Ignore storage access errors (privacy mode / restricted environments)
    }
  }, []);

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, metricsRes, nodesRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/combos/metrics"),
        fetch("/api/provider-nodes"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const metricsData = await metricsRes.json();
      const nodesData = nodesRes.ok ? await nodesRes.json() : { nodes: [] };

      if (combosRes.ok) setCombos((combosData.combos || []).filter((c) => !c.isHidden));
      if (providersRes.ok) {
        const active = (providersData.connections || []).filter(isEligibleActiveConnection);
        setActiveProviders(active);
      }
      if (metricsRes.ok) setMetrics(metricsData.metrics || {});
      setProviderNodes(nodesData.nodes || []);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
        setRecentlyCreatedCombo(data.name?.trim() || "");
        notify.success(t("comboCreated"));
      } else {
        const err = await res.json();
        notify.error(err.error?.message || err.error || t("failedCreate"));
      }
    } catch (error) {
      notify.error(t("errorCreating"));
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
        notify.success(t("comboUpdated"));
      } else {
        const err = await res.json();
        notify.error(err.error?.message || err.error || t("failedUpdate"));
      }
    } catch (error) {
      notify.error(t("errorUpdating"));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos(combos.filter((c) => c.id !== id));
        notify.success(t("comboDeleted"));
      }
    } catch (error) {
      notify.error(t("errorDeleting"));
    }
  };

  const handleDuplicate = async (combo) => {
    const baseName = combo.name.replace(/-copy(-\d+)?$/, "");
    const existingNames = combos.map((c) => c.name);
    let newName = `${baseName}-copy`;
    let counter = 1;
    while (existingNames.includes(newName)) {
      counter++;
      newName = `${baseName}-copy-${counter}`;
    }

    const data = {
      name: newName,
      models: combo.models,
      strategy: combo.strategy || "priority",
      config: sanitizeComboRuntimeConfig(combo.config),
    };

    await handleCreate(data);
  };

  // Kimi Coding preset (2026-07 partnership) — one-click create, mirrors
  // handleDuplicate's directness (no separate confirmation modal). See
  // KimiComboPresetCard.tsx for why this bypasses the combo builder wizard.
  const handleCreateKimiPreset = async () => {
    setCreatingKimiPreset(true);
    try {
      await handleCreate(KIMI_CODING_PRESET);
    } finally {
      setCreatingKimiPreset(false);
    }
  };

  const handleTestCombo = async (combo) => {
    setTestingCombo(combo.name);
    setTestResults(null);
    try {
      const res = await fetch("/api/combos/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboName: combo.name }),
      });
      const data = await res.json();
      setTestResults(data);
    } catch (error) {
      setTestResults({ error: t("testFailed") });
      notify.error(t("testFailed"));
    }
  };

  const handleToggleCombo = async (combo) => {
    const newActive = combo.isActive === false ? true : false;
    const previousActive = combo.isActive !== false;
    // Optimistic update
    setCombos((prev) => prev.map((c) => (c.id === combo.id ? { ...c, isActive: newActive } : c)));
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newActive }),
      });
      if (!res.ok) {
        // The server rejected the toggle (4xx/5xx). Surface its message instead
        // of silently reverting with a generic toast — never swallow the error.
        const errorBody = await res.json().catch(() => null);
        setCombos((prev) =>
          prev.map((c) => (c.id === combo.id ? { ...c, isActive: previousActive } : c))
        );
        notify.error(resolveServerErrorMessage(errorBody, t("failedToggle")));
      }
    } catch (error) {
      // Revert on network error
      setCombos((prev) =>
        prev.map((c) => (c.id === combo.id ? { ...c, isActive: previousActive } : c))
      );
      notify.error(t("failedToggle"));
    }
  };

  const handleHideUsageGuideForever = () => {
    setShowUsageGuide(false);
    try {
      globalThis.localStorage?.setItem(COMBO_USAGE_GUIDE_STORAGE_KEY, "1");
    } catch {}
  };

  const handleShowUsageGuide = () => {
    setShowUsageGuide(true);
    try {
      globalThis.localStorage?.removeItem(COMBO_USAGE_GUIDE_STORAGE_KEY);
    } catch {}
  };

  const handleFilterChange = (nextFilter) => {
    const params = new URLSearchParams(searchParams.toString());

    if (nextFilter === "all") {
      params.delete("filter");
    } else {
      params.set("filter", nextFilter);
    }

    const queryString = params.toString();
    router.replace(`/dashboard/combos${queryString ? `?${queryString}` : ""}`, { scroll: false });
  };

  const handleIntelligentComboUpdated = (updatedCombo) => {
    setCombos((previousCombos) =>
      previousCombos.map((combo) => (combo.id === updatedCombo?.id ? updatedCombo : combo))
    );
  };

  const resetComboDragState = () => {
    comboDragIndexRef.current = null;
    setComboDragIndex(null);
    setComboDragOverIndex(null);
  };

  const handleComboDragStart = (e, index) => {
    if (savingComboOrder || activeFilter !== "all" || combos.length < 2) {
      e.preventDefault();
      return;
    }
    comboDragIndexRef.current = index;
    setComboDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", combos[index]?.id || `${index}`);
    if (e.currentTarget instanceof HTMLElement) {
      setTimeout(() => {
        e.currentTarget.style.opacity = "0.5";
      }, 0);
    }
  };

  const handleComboDragEnd = (e) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
    resetComboDragState();
  };

  const handleComboDragOver = (e, index) => {
    e.preventDefault();
    const activeDragIndex = comboDragIndexRef.current ?? comboDragIndex;
    if (activeDragIndex === null || activeDragIndex === index) return;
    e.dataTransfer.dropEffect = "move";
    setComboDragOverIndex(index);
  };

  const handleComboDrop = async (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = comboDragIndexRef.current ?? comboDragIndex;
    resetComboDragState();

    if (fromIndex === null || fromIndex === dropIndex) return;

    const previousCombos = combos;
    const nextCombos = moveArrayItem(combos, fromIndex, dropIndex);
    setCombos(nextCombos);
    setSavingComboOrder(true);

    try {
      const res = await fetch("/api/combos/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboIds: nextCombos.map((combo) => combo.id) }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Failed to reorder combos");
      }

      if (Array.isArray(data.combos)) {
        setCombos(data.combos);
      }
    } catch {
      setCombos(previousCombos);
      notify.error(getI18nOrFallback(t, "failedReorder", "Failed to save combo order"));
    } finally {
      setSavingComboOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-text-muted mt-1">{t("description")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!showUsageGuide && (
            <Button size="sm" variant="ghost" onClick={handleShowUsageGuide}>
              {getI18nOrFallback(t, "usageGuideShow", "Show guide")}
            </Button>
          )}
          <Button icon="add" onClick={() => setShowCreateModal(true)}>
            {t("createCombo")}
          </Button>
        </div>
      </div>

      <AutoComboCatalog />

      <KimiComboPresetCard
        alreadyCreated={hasKimiCodingPreset(combos)}
        creating={creatingKimiPreset}
        onCreate={handleCreateKimiPreset}
      />

      {showUsageGuide && (
        <ComboUsageGuide
          onHide={() => setShowUsageGuide(false)}
          onHideForever={handleHideUsageGuideForever}
          onCreateCombo={() => setShowCreateModal(true)}
        />
      )}

      {recentlyCreatedCombo && (
        <Card
          padding="sm"
          className="border border-emerald-500/20 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.08]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {getI18nOrFallback(
                  t,
                  "quickTestTitle",
                  `Combo "${recentlyCreatedCombo}" ready to validate`
                )}
              </p>
              <code className="inline-block text-[11px] mt-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                {recentlyCreatedCombo}
              </code>
              <p className="text-xs text-text-muted mt-0.5">
                {getI18nOrFallback(
                  t,
                  "quickTestDescription",
                  "Run a test now to confirm fallback and latency behavior."
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon="play_arrow"
                onClick={() => {
                  handleTestCombo({ name: recentlyCreatedCombo });
                  setRecentlyCreatedCombo("");
                }}
              >
                {getI18nOrFallback(t, "testNow", "Test now")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRecentlyCreatedCombo("")}>
                {tc("close")}
              </Button>
            </div>
          </div>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 dark:border-white/8 bg-black/[0.02] dark:bg-white/[0.02] p-1">
        {[
          {
            id: "all",
            icon: "layers",
            label: getI18nOrFallback(t, "filterAll", "All"),
            count: combos.length,
          },
          {
            id: "intelligent",
            icon: "auto_awesome",
            label: getI18nOrFallback(t, "filterIntelligent", "Intelligent"),
            count: combos.filter((combo) => getStrategyCategory(combo?.strategy) === "intelligent")
              .length,
          },
          {
            id: "deterministic",
            icon: "sort",
            label: getI18nOrFallback(t, "filterDeterministic", "Deterministic"),
            count: combos.filter(
              (combo) => getStrategyCategory(combo?.strategy) === "deterministic"
            ).length,
          },
        ].map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleFilterChange(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all ${
                isActive
                  ? "border border-primary/20 bg-primary/10 text-primary"
                  : "border border-transparent text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              <span>{tab.label}</span>
              <span className="rounded-full bg-black/5 dark:bg-white/5 px-1.5 py-0.5 text-[11px] text-text-muted">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {activeFilter === "intelligent" && selectedIntelligentCombo && (
        <IntelligentComboPanel
          t={t}
          combo={selectedIntelligentCombo}
          allCombos={intelligentCombos}
          activeProviders={activeProviders}
          onComboUpdated={handleIntelligentComboUpdated}
        />
      )}

      {combos.length === 0 ? (
        <EmptyState
          icon="🧩"
          title={t("noCombosYet")}
          description={t("description")}
          actionLabel={t("createCombo")}
          onAction={() => setShowCreateModal(true)}
        />
      ) : filteredCombos.length === 0 ? (
        <Card padding="sm">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[18px]">filter_alt</span>
              <p className="text-sm font-semibold text-text-main">
                {getI18nOrFallback(t, "filterEmptyTitle", "No combos match this strategy filter.")}
              </p>
            </div>
            <p className="text-sm text-text-muted">
              {activeFilter === "intelligent"
                ? getI18nOrFallback(
                    t,
                    "filterEmptyIntelligentDescription",
                    "Create an auto or LKGP combo to populate the intelligent routing dashboard."
                  )
                : getI18nOrFallback(
                    t,
                    "filterEmptyDeterministicDescription",
                    "Only auto and LKGP combos exist right now. Switch back to All or create a deterministic combo."
                  )}
            </p>
            <div>
              <Button size="sm" icon="add" onClick={() => setShowCreateModal(true)}>
                {t("createCombo")}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredCombos.map((combo, index) => (
            <div
              key={combo.id}
              data-testid={`combo-card-${combo.id}`}
              onClick={() => {
                if (isIntelligentStrategy(combo?.strategy)) {
                  setSelectedIntelligentComboId(combo.id);
                }
              }}
              onDragOver={(e) => handleComboDragOver(e, index)}
              onDrop={(e) => handleComboDrop(e, index)}
            >
              <ComboCard
                combo={combo}
                metrics={metrics[combo.name]}
                compressionEnabled={promptCompressionEnabled}
                providerNodes={providerNodes}
                copied={copied}
                onCopy={copy}
                onEdit={() => setEditingCombo(combo)}
                onDelete={() => handleDelete(combo.id)}
                onDuplicate={() => handleDuplicate(combo)}
                onTest={() => handleTestCombo(combo)}
                testing={testingCombo === combo.name}
                onProxy={() => setProxyTargetCombo(combo)}
                hasProxy={comboProxyAssignedIds.has(combo.id) || !!proxyConfig?.combos?.[combo.id]}
                onToggle={() => handleToggleCombo(combo)}
                dragDisabled={savingComboOrder || activeFilter !== "all" || combos.length < 2}
                isDragged={comboDragIndex === index}
                isDropTarget={comboDragOverIndex === index && comboDragIndex !== index}
                isSelected={selectedIntelligentCombo?.id === combo.id}
                onDragStart={(e) => handleComboDragStart(e, index)}
                onDragEnd={handleComboDragEnd}
              />
            </div>
          ))}
        </div>
      )}

      {testResults && (
        <Modal
          isOpen={!!testResults}
          onClose={() => {
            setTestResults(null);
            setTestingCombo(null);
          }}
          title={t("testResults", { name: testingCombo })}
        >
          <TestResultsView results={testResults} />
        </Modal>
      )}

      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
        combo={null}
        comboConfigMode={comboConfigMode}
      />

      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
        comboConfigMode={comboConfigMode}
      />

      {proxyTargetCombo && (
        <ProxyConfigModal
          isOpen={!!proxyTargetCombo}
          onClose={() => (setProxyTargetCombo(null), fetchComboProxyAssignments())}
          level="combo"
          levelId={proxyTargetCombo.id}
          levelLabel={proxyTargetCombo.name}
        />
      )}
    </div>
  );
}

const COMBO_WIZARD_STEPS = [
  {
    step: 1,
    icon: "badge",
    titleKey: "wizardStep1Title",
    descKey: "wizardStep1Desc",
  },
  {
    step: 2,
    icon: "hub",
    titleKey: "wizardStep2Title",
    descKey: "wizardStep2Desc",
  },
  {
    step: 3,
    icon: "route",
    titleKey: "wizardStep3Title",
    descKey: "wizardStep3Desc",
  },
  {
    step: 4,
    icon: "check_circle",
    titleKey: "wizardStep4Title",
    descKey: "wizardStep4Desc",
  },
];

function ComboUsageGuide({ onHide, onHideForever, onCreateCombo }) {
  const t = useTranslations("combos");

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[16px]">
              tips_and_updates
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {getI18nOrFallback(t, "wizardGuideTitle", "Getting Started with Combos")}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {getI18nOrFallback(
                t,
                "wizardGuideDesc",
                "Create model combos to route AI traffic intelligently"
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onHide} className="!h-6 px-2 text-[10px]">
            {getI18nOrFallback(t, "usageGuideHide", "Hide")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onHideForever}
            className="!h-6 px-2 text-[10px]"
          >
            {getI18nOrFallback(t, "usageGuideDontShowAgain", "Don't show again")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        {COMBO_WIZARD_STEPS.map((step, index) => {
          return (
            <div
              key={step.step}
              className="relative rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-2.5"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {step.step}
                </span>
                <span className="material-symbols-outlined text-[14px] text-primary">
                  {step.icon}
                </span>
              </div>
              <p className="text-xs font-medium">
                {getI18nOrFallback(t, step.titleKey, step.titleKey)}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">
                {getI18nOrFallback(t, step.descKey, step.descKey)}
              </p>
              {index < COMBO_WIZARD_STEPS.length - 1 && (
                <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-text-muted md:block">
                  <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" icon="add" onClick={onCreateCombo}>
          {getI18nOrFallback(t, "createFirstCombo", "Create Your First Combo")}
        </Button>
        <span className="text-[10px] text-text-muted">
          {getI18nOrFallback(t, "wizardGuideHint", "or click + Create Combo above")}
        </span>
      </div>
    </Card>
  );
}

function ComboCardInner({
  combo,
  metrics,
  compressionEnabled,
  copied,
  onCopy,
  onEdit,
  onDelete,
  onDuplicate,
  onTest,
  testing,
  onProxy,
  hasProxy,
  onToggle,
  providerNodes,
  dragDisabled,
  isDragged,
  isDropTarget,
  isSelected,
  onDragStart,
  onDragEnd,
}) {
  const strategy = combo.strategy || "priority";
  const models = combo.models || [];
  const isDisabled = combo.isActive === false;
  const t = useTranslations("combos");
  const tc = useTranslations("common");
  const emailsVisible = useEmailPrivacyStore((s) => s.emailsVisible);
  const strategyDescription = getStrategyDescription(t, strategy);

  return (
    <Card
      padding="sm"
      className={`group transition-all ${
        isDisabled ? "opacity-50" : ""
      } ${isDropTarget ? "border border-primary/30 bg-primary/5" : ""} ${
        isDragged ? "opacity-60" : ""
      } ${isSelected ? "border-primary/30 bg-primary/[0.04]" : ""}`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-0">
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 w-full">
          <button
            type="button"
            draggable={!dragDisabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            data-testid={`combo-drag-handle-${combo.id}`}
            className={`p-1 rounded-md transition-colors shrink-0 ${
              dragDisabled
                ? "cursor-not-allowed text-text-muted/40"
                : "cursor-grab active:cursor-grabbing text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"
            }`}
            title={getI18nOrFallback(t, "reorderHandle", "Drag to reorder combo")}
            aria-label={getI18nOrFallback(t, "reorderHandle", "Drag to reorder combo")}
          >
            <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
          </button>

          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <code className="text-sm font-medium font-mono truncate">{combo.name}</code>
              <Tooltip content={strategyDescription}>
                <span
                  className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full ${getStrategyBadgeClass(
                    strategy
                  )}`}
                >
                  {getStrategyLabel(t, strategy)}
                </span>
              </Tooltip>
              {hasProxy && (
                <span
                  className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary flex items-center gap-0.5"
                  title={t("proxyConfigured")}
                >
                  <span className="material-symbols-outlined text-[11px]">vpn_lock</span>
                  proxy
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(combo.name, `combo-${combo.id}`);
                }}
                className="p-0.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                title={t("copyComboName")}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copied === `combo-${combo.id}` ? "check" : "content_copy"}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {models.length === 0 ? (
                <span className="text-xs text-text-muted italic">{t("noModels")}</span>
              ) : (
                models.slice(0, 3).map((entry, index) => {
                  const { weight } = normalizeModelEntry(entry);
                  return (
                    <code
                      key={index}
                      className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded text-text-muted"
                    >
                      {formatComboEntryDisplay(entry, {
                        providerNodes,
                        includeConnection: true,
                        showFullEmails: emailsVisible,
                      })}
                      {strategy === "weighted" && weight > 0 ? ` (${weight}%)` : ""}
                    </code>
                  );
                })
              )}
              {models.length > 3 && (
                <span className="text-[10px] text-text-muted">
                  {t("more", { count: models.length - 3 })}
                </span>
              )}
            </div>

            {metrics && (
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] text-text-muted">
                  <span className="text-emerald-500">{metrics.totalSuccesses}</span>/
                  {metrics.totalRequests} {t("reqs")}
                </span>
                <span className="text-[10px] text-text-muted">
                  {metrics.successRate}% {t("success")}
                </span>
                <span className="text-[10px] text-text-muted">~{metrics.avgLatencyMs}ms</span>
                {metrics.fallbackRate > 0 && (
                  <span className="text-[10px] text-amber-500">
                    {metrics.fallbackRate}% fallback
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-1.5 shrink-0 ml-0 md:ml-2 w-full md:w-auto mt-2 md:mt-0 pt-2 md:pt-0 border-t border-black/5 dark:border-white/5 md:border-t-0">
          <div className="flex items-center gap-2">
            <Toggle
              size="sm"
              checked={!isDisabled}
              onChange={onToggle}
              title={isDisabled ? t("enableCombo") : t("disableCombo")}
            />
            <span className="text-[10px] text-text-muted md:hidden">
              {isDisabled ? "Disabled" : "Active"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 transition-opacity">
            {compressionEnabled && (
              <ComboCompressionModeSelect
                combo={combo}
                title={t("compressionOverride")}
                className="text-xs py-1 px-2 rounded border border-black/10 dark:border-white/10 bg-surface text-text-main focus:border-primary focus:outline-none transition-colors disabled:opacity-50 max-w-[130px] md:max-w-none"
              />
            )}
            <Link
              href={`/dashboard/combos/${combo.id}`}
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors"
              title={getI18nOrFallback(t, "controlCenter", "Control Center")}
            >
              <span className="material-symbols-outlined text-[16px]">monitoring</span>
            </Link>
            <button
              onClick={onTest}
              disabled={testing}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-emerald-500 transition-colors"
              title={t("testCombo")}
            >
              <span
                className={`material-symbols-outlined text-[16px] ${testing ? "animate-spin" : ""}`}
              >
                {testing ? "progress_activity" : "play_arrow"}
              </span>
            </button>
            <button
              onClick={onDuplicate}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors"
              title={t("duplicate")}
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
            <button
              onClick={onProxy}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors"
              title={t("proxyConfig")}
            >
              <span className="material-symbols-outlined text-[16px]">vpn_lock</span>
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors"
              title={tc("edit")}
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 hover:bg-red-500/10 rounded text-red-500 transition-colors"
              title={tc("delete")}
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
const ComboCard = memo(ComboCardInner);

function TestResultsView({ results }) {
  const emailsVisible = useEmailPrivacyStore((s) => s.emailsVisible);

  if (results.error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm">
        <span className="material-symbols-outlined text-[18px]">error</span>
        {typeof results.error === "string" ? results.error : JSON.stringify(results.error)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {results.resolvedBy && (
        <div className="flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined text-emerald-500 text-[18px]">
            check_circle
          </span>
          <div className="min-w-0">
            <div>
              Resolved by:{" "}
              <code className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                {results.resolvedBy}
              </code>
            </div>
            {results.resolvedByTarget?.connectionId || results.resolvedByTarget?.stepId ? (
              <div className="mt-1 text-xs text-text-muted">
                {results.resolvedByTarget?.connectionId
                  ? `account ${results.resolvedByTarget.connectionId.slice(0, 8)}`
                  : "dynamic account"}
                {results.resolvedByTarget?.stepId
                  ? ` · step ${results.resolvedByTarget.stepId}`
                  : ""}
              </div>
            ) : null}
          </div>
        </div>
      )}
      {results.results?.map((r, i) => (
        <div
          key={i}
          title={r.error || undefined}
          className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-black/[0.02] dark:bg-white/[0.02]"
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              r.status === "ok"
                ? "text-emerald-500"
                : r.status === "skipped"
                  ? "text-text-muted"
                  : "text-red-500"
            }`}
          >
            {r.status === "ok" ? "check_circle" : r.status === "skipped" ? "skip_next" : "error"}
          </span>
          <div className="min-w-0 flex-1">
            <code className="font-mono block truncate">
              {pickDisplayValue([r.label], emailsVisible, r.model)}
            </code>
            {r.connectionId || r.stepId ? (
              <div className="mt-0.5 text-[10px] text-text-muted">
                {r.connectionId ? `acct ${r.connectionId.slice(0, 8)}` : "dynamic account"}
                {r.stepId ? ` · ${r.stepId}` : ""}
              </div>
            ) : null}
          </div>
          {r.latencyMs !== undefined && <span className="text-text-muted">{r.latencyMs}ms</span>}
          <span
            className={`text-[10px] uppercase font-medium ${
              r.status === "ok"
                ? "text-emerald-500"
                : r.status === "skipped"
                  ? "text-text-muted"
                  : "text-red-500"
            }`}
          >
            {r.status}
          </span>
        </div>
      ))}
    </div>
  );
}
