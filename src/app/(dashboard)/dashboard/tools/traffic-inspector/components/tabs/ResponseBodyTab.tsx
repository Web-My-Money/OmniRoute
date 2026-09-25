"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { InterceptedRequest } from "@/mitm/inspector/types";
import { parseSseStream, mergeStream } from "@/mitm/inspector/sseMerger";
import type { MergedResponse } from "@/mitm/inspector/sseMerger";
import { JsonViewer } from "../shared/JsonViewer";
import { SseEventList } from "../shared/SseEventList";

interface ResponseBodyTabProps {
  request: InterceptedRequest;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface MergedDisplay {
  text: string;
  toolCalls: unknown[];
}

// Pulls readable text + tool calls out of the format-specific rebuilt
// `message` shape produced by sseMerger (openai / anthropic / gemini).
function extractMergedDisplay(merged: MergedResponse): MergedDisplay | null {
  const msg = asRecord(merged.message);
  if (!msg) return null;
  const texts: string[] = [];
  const toolCalls: unknown[] = [];

  if (merged.format === "openai" && Array.isArray(msg.choices)) {
    for (const raw of msg.choices) {
      const m = asRecord(asRecord(raw)?.message);
      if (!m) continue;
      if (typeof m.content === "string" && m.content) texts.push(m.content);
      if (Array.isArray(m.tool_calls)) toolCalls.push(...m.tool_calls);
    }
  } else if (merged.format === "anthropic" && Array.isArray(msg.content)) {
    for (const raw of msg.content) {
      const block = asRecord(raw);
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        texts.push(block.text);
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking
      ) {
        texts.push(block.thinking);
      } else if (block.type === "tool_use") {
        toolCalls.push(block);
      }
    }
  } else if (merged.format === "gemini" && Array.isArray(msg.candidates)) {
    for (const candRaw of msg.candidates) {
      const content = asRecord(asRecord(candRaw)?.content);
      if (!Array.isArray(content?.parts)) continue;
      for (const partRaw of content.parts) {
        const part = asRecord(partRaw);
        if (!part) continue;
        if (typeof part.text === "string" && part.text) texts.push(part.text);
        else if (part.functionCall != null) toolCalls.push(part.functionCall);
      }
    }
  } else {
    return null;
  }
  return { text: texts.join("\n"), toolCalls };
}

export function ResponseBodyTab({ request }: ResponseBodyTabProps) {
  const t = useTranslations("trafficInspector");
  const [showRaw, setShowRaw] = useState(false);

  const body = request.responseBody;
  if (!body) {
    return <p className="p-4 text-sm text-text-muted">{t("noResponseBody")}</p>;
  }

  const isSSE = body.startsWith("data:") || body.includes("\ndata:");
  const events = isSSE ? parseSseStream(body) : [];
  const merged = isSSE && !showRaw ? mergeStream(events) : null;
  const display = merged ? extractMergedDisplay(merged) : null;

  let parsed: unknown = null;
  if (!isSSE) {
    try {
      parsed = JSON.parse(body);
    } catch {
      // not JSON
    }
  }

  return (
    <div className="h-full flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        {isSSE && (
          <button
            type="button"
            onClick={() => setShowRaw((r) => !r)}
            className="text-xs text-text-muted hover:text-text-main border border-border rounded px-2 py-0.5 focus-ring"
          >
            {showRaw ? t("mergedView") : t("rawEvents")}
          </button>
        )}
        <span className="ml-auto text-xs text-text-muted">{request.responseSize} B</span>
        {request.status === "in-flight" && (
          <span className="text-xs text-amber-400 animate-pulse">{t("streaming")}</span>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-bg-subtle rounded border border-border p-2">
        {isSSE && showRaw ? (
          <SseEventList events={events} />
        ) : isSSE && merged ? (
          display ? (
            <div className="space-y-2">
              {display.text && (
                <pre className="text-xs font-mono text-text-main whitespace-pre-wrap break-words">
                  {display.text}
                </pre>
              )}
              {display.toolCalls.length > 0 && <JsonViewer data={display.toolCalls} />}
            </div>
          ) : (
            <JsonViewer data={merged.message ?? merged.raw} />
          )
        ) : parsed ? (
          <JsonViewer data={parsed} />
        ) : (
          <pre className="text-xs font-mono text-text-main whitespace-pre-wrap break-all">
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}
