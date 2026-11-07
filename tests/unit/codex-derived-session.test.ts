import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCodexConversationSessionId,
  extractCodexConversationPrefix,
  withDerivedCodexSessionHeader,
} from "../../open-sse/config/codexDerivedSession.ts";
import { getCodexConvergedThreadId } from "../../open-sse/config/codexIdentity.ts";

// WMM fork regression: upstream PR #18274 (v3.8.53) stopped sending a Codex session for clients
// that present none. Hermes presents none, and its Codex cache-read share fell 84.5% -> 14.9%
// (canary: 24,960/25,092 tokens cached WITH a session header, 0 without). The executor now
// derives a stable per-conversation session server-side and presents it like a client one.

const SEED = "5c1f0f0e-3a52-4d6e-9d7e-1c0f6e0a9b11";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_SESSION = "01a0df6b-bb00-73d3-ad8c-6138d4a9b838";
const SYSTEM = "You are Hermes. Follow the house rules.";

const user = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "output_text", text }],
});

function conversation(firstUser: string, extraTurns = 0) {
  const input: unknown[] = [{ role: "developer", content: SYSTEM }, user(firstUser)];
  for (let i = 0; i < extraTurns; i += 1)
    input.push(assistant(`answer ${i}`), user(`follow-up ${i}`));
  return { model: "gpt-5.5", input, stream: true };
}

function psd(extra: Record<string, unknown> = {}) {
  return { workspaceId: "ws-derived", codexFingerprintSeed: SEED, ...extra };
}

test("a client-provided session is preserved untouched (header or body)", () => {
  const headers = { "x-session-id": CLIENT_SESSION };
  assert.equal(withDerivedCodexSessionHeader(headers, conversation("hello"), psd(), "c1"), headers);
  const aliased = { "X-OpenCode-Session-Id": CLIENT_SESSION };
  assert.equal(withDerivedCodexSessionHeader(aliased, conversation("hello"), psd(), "c1"), aliased);
  for (const field of ["prompt_cache_key", "session_id", "conversation_id"]) {
    const body = { ...conversation("hello"), [field]: CLIENT_SESSION };
    const none = null;
    assert.equal(withDerivedCodexSessionHeader(none, body, psd(), "c1"), none);
  }
});

test("no client session: the derived id is stable across turns and differs across conversations", () => {
  const turn1 = deriveCodexConversationSessionId(conversation("plan the launch"), psd(), "c1");
  const turn2 = deriveCodexConversationSessionId(conversation("plan the launch", 3), psd(), "c1");
  const other = deriveCodexConversationSessionId(conversation("audit the ad account"), psd(), "c1");
  assert.match(turn1 ?? "", UUID_V4);
  assert.equal(turn1, turn2, "later turns of one conversation keep the id");
  assert.notEqual(turn1, other, "a different conversation gets a different id");
});

test("the derived id carries no message text and is keyed by the connection seed", () => {
  const body = conversation("my card number is 4111111111111111");
  const a = deriveCodexConversationSessionId(body, psd(), "c1") ?? "";
  const b = deriveCodexConversationSessionId(
    body,
    psd({ codexFingerprintSeed: CLIENT_SESSION }),
    "c1"
  );
  assert.ok(!a.includes("4111") && !a.toLowerCase().includes("card"));
  assert.notEqual(a, b, "a different seed yields a different id for the same conversation");
});

test("the system prompt tail does not churn the id, its head does", () => {
  const withTail = (tail: string) => ({
    model: "gpt-5.5",
    instructions: `${"x".repeat(5000)}${tail}`,
    input: [user("hello")],
  });
  assert.equal(
    deriveCodexConversationSessionId(withTail("skills v1"), psd(), "c1"),
    deriveCodexConversationSessionId(withTail("skills v2"), psd(), "c1")
  );
  assert.notEqual(
    deriveCodexConversationSessionId(withTail(""), psd(), "c1"),
    deriveCodexConversationSessionId(
      { ...withTail(""), instructions: `different persona${"x".repeat(5000)}` },
      psd(),
      "c1"
    )
  );
});

test("no usable prefix: no id is derived and the headers stay as they were", () => {
  const unusable: unknown[] = [
    null,
    {},
    { model: "gpt-5.5", input: [] },
    { model: "gpt-5.5", input: [{ role: "developer", content: SYSTEM }] },
    { model: "gpt-5.5", input: [user("   ")] },
    { ...conversation("hello"), previous_response_id: "resp_1" },
  ];
  for (const body of unusable) {
    assert.equal(extractCodexConversationPrefix(body), null);
    assert.equal(deriveCodexConversationSessionId(body, psd(), "c1"), null);
    const headers = { "user-agent": "hermes" };
    assert.equal(withDerivedCodexSessionHeader(headers, body, psd(), "c1"), headers);
  }
});

test("Chat Completions bodies (messages) and string input give the same prefix rules", () => {
  const chat = {
    model: "gpt-5.5",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "plan the launch" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "and then?" },
    ],
  };
  const chatId = deriveCodexConversationSessionId(chat, psd(), "c1");
  assert.match(chatId ?? "", UUID_V4);
  assert.equal(
    chatId,
    deriveCodexConversationSessionId({ ...chat, messages: chat.messages.slice(0, 2) }, psd(), "c1")
  );
  assert.ok(
    deriveCodexConversationSessionId({ model: "gpt-5.5", input: "just a string" }, psd(), "c1")
  );
});

test("an unusable client alias does not shadow the derived id, other headers are kept", () => {
  const next = withDerivedCodexSessionHeader(
    { "X-Session-Id": "bad/session", "user-agent": "hermes" },
    conversation("hello"),
    psd(),
    "c1"
  );
  assert.ok(next);
  assert.equal(next["user-agent"], "hermes");
  assert.equal(next["X-Session-Id"], undefined);
  assert.match(next["x-session-id"], UUID_V4);
});

test("WMM_CODEX_DERIVED_SESSION=0 disables the derivation", () => {
  const previous = process.env.WMM_CODEX_DERIVED_SESSION;
  process.env.WMM_CODEX_DERIVED_SESSION = "0";
  try {
    const headers = { "user-agent": "hermes" };
    assert.equal(
      withDerivedCodexSessionHeader(headers, conversation("hello"), psd(), "c1"),
      headers
    );
  } finally {
    if (previous === undefined) delete process.env.WMM_CODEX_DERIVED_SESSION;
    else process.env.WMM_CODEX_DERIVED_SESSION = previous;
  }
});

// ── end to end: the id actually reaches the upstream request ──────────────────────────────────

async function sendThroughExecutor(
  body: Record<string, unknown>,
  options: {
    clientHeaders?: Record<string, string> | null;
    providerSpecificData?: Record<string, unknown>;
  } = {}
) {
  const { CodexExecutor } = await import("../../open-sse/executors/codex.ts");
  const executor = new CodexExecutor();
  const originalFetch = globalThis.fetch;
  let headers = new Headers();
  let upstreamBody: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    headers = new Headers(init?.headers);
    upstreamBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ id: "resp-derived", object: "response" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await executor.execute({
      model: "gpt-5.5",
      body,
      stream: true,
      clientHeaders: options.clientHeaders ?? { "user-agent": "hermes-agent" },
      credentials: {
        accessToken: "codex-token",
        connectionId: "conn-derived",
        providerSpecificData: psd(options.providerSpecificData),
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { headers, upstreamBody };
}

test("e2e (convergence mode, the production default): conversation thread reaches upstream", async () => {
  const t1 = await sendThroughExecutor(conversation("plan the launch"));
  const t2 = await sendThroughExecutor(conversation("plan the launch", 2));
  const other = await sendThroughExecutor(conversation("audit the ad account"));

  for (const sent of [t1, t2, other]) {
    assert.ok(sent.headers.get("session_id"), "a session_id header is sent");
    assert.ok(sent.headers.get("thread-id"), "a thread-id header is sent");
    assert.ok(sent.headers.get("x-codex-window-id"));
  }
  assert.equal(t1.headers.get("thread-id"), t2.headers.get("thread-id"));
  assert.notEqual(t1.headers.get("thread-id"), other.headers.get("thread-id"));
  // The thread is derived from the server-side id exactly like a client-provided one.
  const derived = deriveCodexConversationSessionId(
    conversation("plan the launch"),
    psd(),
    "conn-derived"
  );
  assert.equal(
    t1.headers.get("thread-id"),
    getCodexConvergedThreadId(derived, psd(), "conn-derived")
  );
  // Same envelope in the body metadata.
  const metadata = t1.upstreamBody.client_metadata as Record<string, unknown>;
  assert.equal(metadata.thread_id, t1.headers.get("thread-id"));
});

test("e2e (passthrough mode): the derived id is the session_id header itself", async () => {
  const off = { codexFingerprintMode: "off" };
  const t1 = await sendThroughExecutor(conversation("plan the launch"), {
    providerSpecificData: off,
  });
  const t2 = await sendThroughExecutor(conversation("plan the launch", 2), {
    providerSpecificData: off,
  });
  const other = await sendThroughExecutor(conversation("audit the ad account"), {
    providerSpecificData: off,
  });
  const derived = deriveCodexConversationSessionId(
    conversation("plan the launch"),
    psd(off),
    "conn-derived"
  );
  assert.match(derived ?? "", UUID_V4);
  assert.equal(t1.headers.get("session_id"), derived);
  assert.equal(t2.headers.get("session_id"), derived);
  assert.notEqual(other.headers.get("session_id"), derived);
});

test("e2e: a client-provided session is not replaced; no prefix means no session headers", async () => {
  const clientSent = await sendThroughExecutor(conversation("plan the launch"), {
    clientHeaders: { "session-id": CLIENT_SESSION },
  });
  assert.equal(
    clientSent.headers.get("thread-id"),
    getCodexConvergedThreadId(CLIENT_SESSION, psd(), "conn-derived")
  );

  const bare = await sendThroughExecutor({ model: "gpt-5.5", input: [], stream: true });
  assert.equal(bare.headers.get("session_id"), null);
  assert.equal(bare.headers.get("thread-id"), null);
});
