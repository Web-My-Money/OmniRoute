"""Regenerate Dockerfile.railway from upstream's Dockerfile + the WMM deltas.

Run from the omniroute worktree root:  python ../gen_dockerfile_railway.py <upstream Dockerfile path>
"""
import re
import subprocess
import sys

BS = "\\"
up = open(sys.argv[1], encoding="utf8").read().split("\n")
old = subprocess.run(["git", "show", "origin/wmm-production:Dockerfile.railway"],
                     capture_output=True, text=True, encoding="utf8").stdout

header = old[: old.index("# ── Common base")]
start = next(i for i, l in enumerate(up) if l.startswith("# ── Common base"))
end = next(i for i, l in enumerate(up) if l.strip() == 'CMD ["node", "dev/run-standalone.mjs"]')
body = "\n".join(up[start : end + 1]) + "\n"

SID = "c1a15bab-c913-4ee7-b676-1a2a1d46967c"
count = 0


def cache(m):
    global count
    count += 1
    return f"id=s/{SID}-{m.group(2)},target={m.group(2)}"


body = re.sub(r"id=s/[0-9a-f-]{36}-([a-z-]+),target=([^,\s]+)", cache, body)
assert "92ca8a61" not in body

tls_old = "  && node node_modules/tls-client-node/scripts/postinstall.js " + BS
assert tls_old in body, "postinstall line moved upstream"
body = body.replace(tls_old, '  && TLS_CLIENT_VERSION="${TLS_CLIENT_VERSION}" node node_modules/tls-client-node/scripts/postinstall.js ' + BS)
msg_old = '|| (echo "tls-client-node native binary missing after postinstall — GitHub API fetch likely rate-limited or failed (#7802)" >&2 && exit 1))'
assert msg_old in body
body = body.replace(msg_old, '|| (echo "tls-client-node native binary missing after postinstall (TLS_CLIENT_VERSION=${TLS_CLIENT_VERSION}) - see the ARG note above" >&2 && exit 1))')

pin_note = old[old.index("# Pin the tls-client release.") : old.index("ARG TLS_CLIENT_VERSION=1.15.1")] + "ARG TLS_CLIENT_VERSION=1.15.1\n"
anchor = f"RUN --mount=type=cache,id=s/{SID}-/root/.npm,target=/root/.npm {BS}\n  npm ci"
assert body.count(anchor) == 1, "npm ci anchor"
i = body.index(anchor)
body = body[:i] + pin_note + body[i:]

pw = (
    "# Pre-bake Playwright Chromium so the container does not re-download it on every start.\n"
    "# The Railway start command keeps a conditional fallback install at\n"
    "# /app/node_modules/playwright/node_modules/playwright-core/cli.js, but the image ships\n"
    "# the browser. The version tracks node_modules/playwright/node_modules/playwright-core\n"
    "# in package-lock.json (1.62.1 at v3.8.50) - bump both together.\n"
    "ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers\n"
    f"RUN test -d /app/node_modules/playwright/node_modules/playwright-core && {BS}\n"
    f"    mkdir -p /app/.playwright-browsers && {BS}\n"
    f"    cd /tmp && rm -rf pwfetch && mkdir pwfetch && cd pwfetch && {BS}\n"
    f"    npm pack playwright-core@1.62.1 --silent && {BS}\n"
    f"    tar -xzf playwright-core-1.62.1.tgz && {BS}\n"
    f"    cp -fv package/browsers.json /app/node_modules/playwright/node_modules/playwright-core/browsers.json && {BS}\n"
    f"    node package/cli.js install chromium && {BS}\n"
    "    cd / && rm -rf /tmp/pwfetch\n\n"
)
chown = "# Hand /app over to the baked-in `node` non-root user"
assert body.count(chown) == 1
body = body.replace(chown, pw + chown)

header = header.replace(
    "The image actually live in production (`diegosouzapw/omniroute:3.8.49`)",
    "The image originally live in production (`diegosouzapw/omniroute:3.8.49`)",
)
header += "# Regenerated 2026-09-25 from upstream v3.8.50 `Dockerfile` (rebase of wmm-production).\n\n"
open("Dockerfile.railway", "w", encoding="utf8", newline="\n").write(header + body)
print("cache mounts rewritten:", count)
