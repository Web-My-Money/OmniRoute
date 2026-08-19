# Syncing upstream OmniRoute changes into WMM's fork

This fork tracks upstream `diegosouzapw/OmniRoute`. The WMM production branch is
`wmm-production`. It carries two load-bearing WMM changes:

- `Dockerfile.railway` — truncated Dockerfile for Railway (must be re-synced by hand)
- `src/shared/middleware/chatBodyAdmission.ts` — fixes false-positive `chat_admission_busy`
  on tool-schema-heavy Multica/Hermes requests

## Merge procedure

```bash
git remote add upstream https://github.com/diegosouzapw/OmniRoute.git
git fetch upstream
git checkout wmm-production
git merge upstream/main        # or upstream/release/vX.Y.Z, or a tag
# resolve conflicts, especially in chatBodyAdmission.ts and Dockerfile areas
git push origin wmm-production
```

## After every merge, verify these three things

1. **`chatBodyAdmission.ts` still contains the WMM fix.** If upstream changed the same
   file, the admission guard may silently revert and tool-schema-heavy agent calls will
   start returning 503 again.
2. **`Dockerfile.railway` still builds on Railway.** Re-sync it against upstream's
   `Dockerfile` if upstream changed the build. The cache-mount ids in it are hardcoded
   to the live production service id; do not change them unless you are intentionally
   building a different service.
3. **Major version schema changes.** OmniRoute state lives in `storage.sqlite` on the
   Railway volume. A major upstream version may migrate it in place. Test on a copy
   before deploying to production.

## What not to do

- **Never "bump the pinned image tag"** to the upstream image. That drops the WMM fixes.
- **Never delete `Dockerfile.railway`** until Railway supports `--target` selection.
