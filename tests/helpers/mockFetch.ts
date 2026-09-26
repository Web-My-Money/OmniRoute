// Shared loose-but-typed init shape for fetch() mocks in node:test suites.
// Real RequestInit unions (HeadersInit / BodyInit) make plain member access —
// init.headers.Authorization, JSON.parse(init.body) — unusable without casts,
// while tests only ever pass plain objects and JSON strings.
// Keep every declared prop assignable to RequestInit so mocks still satisfy
// globalThis.fetch's signature.
export interface MockRequestInit {
  method?: string;
  // Intersection keeps both plain-key access (init.headers.Cookie) and
  // Headers methods (init.headers.get/.forEach/.entries) usable; remains
  // assignable to HeadersInit via the Headers member.
  headers?: Record<string, string> & Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock bodies arrive as string, FormData, or URLSearchParams across call sites
  body?: any;
  signal?: AbortSignal | null;
  credentials?: RequestCredentials;
  duplex?: "half";
  [key: string]: unknown;
}
