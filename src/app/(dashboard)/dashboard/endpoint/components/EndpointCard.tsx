"use client";

import { useTranslations } from "next-intl";
import type { CopyHandler, EndpointModelSummary } from "../endpointTypes";

export default function EndpointCard({
  icon,
  iconColor,
  iconBg,
  title,
  path,
  models,
  copy,
  copied,
  baseUrl,
  badge,
  modelsLoading = false,
}: Readonly<{
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  path: string;
  models: EndpointModelSummary[] | null;
  copy: CopyHandler;
  copied?: string | null;
  baseUrl: string;
  badge?: string;
  modelsLoading?: boolean;
}>) {
  const t = useTranslations("endpoint");
  const copyId = `endpoint_${path}`;
  const fullUrl = `${baseUrl.replace(/\/v1$/, "")}${path}`;

  return (
    <div className="border border-border rounded-lg p-3 hover:bg-surface/30 transition-colors flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconBg} shrink-0`}>
          <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-xs leading-tight">{title}</span>
            {badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-border/60 text-text-muted font-medium uppercase tracking-wider leading-none">
                {badge}
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted mt-0.5 block">
            {models === null
              ? "—"
              : modelsLoading
                ? "..."
                : t("modelsCount", { count: models.length })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[10px] font-mono text-text-muted bg-surface/80 px-2 py-1 rounded truncate">
          {path}
        </code>
        <button
          onClick={() => void copy(fullUrl, copyId)}
          className="shrink-0 flex items-center justify-center size-6 rounded hover:bg-sidebar transition-colors"
          title={t("copyUrl")}
        >
          <span className="material-symbols-outlined text-[12px] text-text-muted">
            {copied === copyId ? "check" : "content_copy"}
          </span>
        </button>
      </div>
    </div>
  );
}
