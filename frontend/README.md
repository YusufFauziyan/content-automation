# Yu-tomation — frontend

The workflow editor: a node canvas for the video pipeline, with the two things
that matter when a run breaks — supplying a still by hand, and continuing from
the step that failed.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## What it does

**Canvas.** The thirteen pipeline steps as nodes, coloured by category, wired
left to right. Drag to pan, scroll to zoom, click a node to inspect it. Status
comes from the run, so a failed step is visible without opening anything.

**Recovering a failed image step.** When the provider runs out of capacity the
run stops with some scenes filled and some empty. Select **Image Generation** and
every scene is listed with the brief that was written for it. Copy the prompt,
make the picture wherever you like, drop it back in. A supplied still is marked
`MANUAL` and stays marked — recovery should never be indistinguishable from
generation.

**Resuming.** The Resume button continues from the step that failed. It refuses
while any scene is still empty, and says which ones. Scenes you supplied are
kept, not regenerated.

**Reviewing the video.** The Output tab of *Video Rendering* plays the result and
puts the audio length beside the subtitle length, because that difference is the
defect that is invisible until the last ten seconds. Scene markers seek the
player.

## Where the data comes from

`lib/server/store.ts` is the seam. Every route handler talks to it and nothing
else, and the shapes it returns already mirror the backend DTOs, so pointing
this at the real backend is a change to one file.

Today it holds one seeded run in memory — a run that failed at `IMAGE` with five
of eight scenes generated, which is the state worth designing against.

Two things are already real rather than mocked:

- **Uploads are written to disk**, at
  `backend/output/workflows/{runId}/images/scene-NNN.jpg` — the path the backend
  looks in. Dimensions are read from the file's own bytes, never from its name.
- **Media is served from `backend/output`** through `/api/media/...`, with range
  requests so the video player can seek, and no path escapes that directory.

## Before this replaces the CLI

The backend needs two things it does not have yet:

1. **An HTTP layer.** It is a CLI today. The routes here are the contract to
   implement against.
2. **`ImageAgent` must skip scenes that already have a file.** Resuming
   currently re-runs the whole image step, which would discard a manually
   supplied still. Without that change, manual recovery works in this UI and is
   thrown away by the real pipeline.

## Stack

Next.js 15 · React 19 · Tailwind v4 · Zustand · lucide-react. Components follow
the shadcn/ui idiom and are written out rather than generated, so there is no
init step to run. Tokens live in `app/globals.css`.

## Signing in

One password guards the whole workspace; there are no accounts.

```bash
APP_PASSWORD=password123     # the default when unset
AUTH_SECRET=change-me        # signs the session cookie
```

`/` and `/login` are public. Everything else redirects to `/login`, and every
data route answers `401` without a valid session.

The session is an expiry plus an HMAC over it, in an `httpOnly` cookie, valid
for twelve hours. Middleware checks the shape and the expiry — the edge runtime
has no `node:crypto` — and the signature is verified again in every page and
route that reads data, which is the actual boundary.

**Its limits, plainly.** A shared password has no per-person revocation and no
audit trail, and a wrong guess costs only the 600ms delay in the login route.
That is proportionate for a personal tool on a private network. Before this is
exposed to the internet it wants real accounts, hashed credentials and rate
limiting by IP.

## Screens

| Route | What it is |
| --- | --- |
| `/` | Landing page. Public. |
| `/login` | Password gate. |
| `/dashboard` | Run counts and the eight most recent runs. |
| `/workflows` | Every run, failures first. |
| `/workflows/[runId]` | The editor: canvas, inspector, console. |
| `/logs` | Newest log records across every run. |
| `/schedules`, `/credentials`, `/settings`, `/help` | Placeholders, and they say so. |

## If the app suddenly fails to start

```
MODULE_NOT_FOUND … next/dist/server/dev/static-paths-worker.js
Could not find a production build in the '.next' directory
```

Both mean the same thing: `.next` holds a mixture of development and production
artefacts. `next dev` and `next build` write to the same directory and overwrite
each other, so running one while the other is going leaves a build that is
neither.

```bash
rm -rf .next && pnpm build     # then pnpm start
# or just: pnpm dev
```

Pick one mode and stay in it. `pnpm dev` for working, `pnpm build && pnpm start`
for checking the production output — never both against the same checkout at the
same time.
