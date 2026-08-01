# Yu-tomation

AI-powered short-form content automation.

**Stateless media, stateful knowledge.** Generated files are disposable;
topics, scripts, scene plans, workflow state and logs are permanent.

---

## Status

The pipeline runs from a topic through to a finished video:

```
Topic → Script → Scene Plan → Visual Briefs → Images
      → Narration Plan → narration.mp3 → subtitle.srt
      → Render Plan → final.mp4
```

Upload is scaffolded but not implemented.
Those steps exist in `PIPELINE_STEPS` and report `NOT_IMPLEMENTED`, so the shape
of the pipeline is visible before all of it is built.

Artefacts are written into the run's working directory:

```
output/workflows/{workflowId}/
  images/scene-001.png …
  audio/narration.mp3
  subtitle/subtitle.srt
  video/final.mp4
```

Only metadata reaches the database — never the bytes. Subtitles are derived
from the same narration plan the audio is spoken from, so no transcription step
is needed to align them.

How far a run goes is set by `PIPELINE_LAST_STEP`. Set it to `SCENE` while your
router has no image provider connected: a run that ends there is a _finished_
run, not a failed one. Move it to `IMAGE` once image generation works — no code
change required.

---

## Requirements

| Tool       | Version                                                       |
| ---------- | ------------------------------------------------------------- |
| Node.js    | 22.12 or newer (24 LTS recommended)                           |
| FFmpeg     | any recent version, **built with libass** (see below)         |
| pnpm       | 11 or newer                                                   |
| Docker     | any recent version, with `docker-compose`                     |
| PostgreSQL | 17 with the `pgvector` extension — supplied by Docker Compose |

An API key for the AI router is required to generate anything.

---

## Run locally

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`. The values you must supply:

| Variable                  | Meaning                                             |
| ------------------------- | --------------------------------------------------- |
| `NINE_ROUTER_API_KEY`     | Key for your 9 Router. Never commit it.             |
| `NINE_ROUTER_TEXT_COMBO`  | Combo used for text, e.g. `opus`.                   |
| `NINE_ROUTER_IMAGE_COMBO` | Combo used for images.                              |
| `DATABASE_URL`            | Must match the Docker Compose credentials and port. |

Optional: set `HUGGINGFACE_API_KEY` to enable the image fallback described under
[Troubleshooting](#troubleshooting). Left empty, image generation depends on the
router alone.

Every variable is validated at startup — the application refuses to boot on an
invalid `.env` rather than failing later inside a workflow.

### 3. Start PostgreSQL and the speech server

```bash
pnpm db:up      # PostgreSQL with pgvector
pnpm voice:up   # Kokoro, for narration.mp3 (~2 GB image, CPU only)
```

Kokoro is only needed from the `voice` step onward. It listens on
`KOKORO_PORT` (8880 by default) and takes a minute to become healthy on first
start.

The CPU image needs roughly **3 GB of memory to itself**. On a Docker VM left
at the 2 GB default it is killed mid-synthesis on anything longer than a couple
of sentences — the symptom is `SPEECH_RETRIES_EXHAUSTED` with
`connection failed while reading the audio`, and a climbing restart count on
`docker inspect yu-tomation-kokoro`. Either raise Docker's memory allocation or
point `KOKORO_BASE_URL` at a hosted server; nothing else changes.

This starts `pgvector/pgvector:pg17` on `POSTGRES_PORT` (5432 by default). If
that port is already taken, change `POSTGRES_PORT` in `.env` and update the
host and port inside `DATABASE_URL` to match.

### 4. Install FFmpeg — with libass

Burned-in subtitles need the `subtitles` filter, which exists only in builds
that include **libass**. Check yours:

```bash
ffmpeg -hide_banner -filters | awk '{print $2}' | grep -qx subtitles \
  && echo "ok" || echo "no libass — captions cannot be burned in"
```

Debian and Ubuntu packages include it, and so does the Docker image. Homebrew's
current `ffmpeg` formula does **not**. On macOS the simplest fix is the wrapper
scripts in `scripts/`, which run FFmpeg inside a small Debian image with the
output directory mounted at its own path:

```bash
docker build -t yu-ffmpeg - <<'DF'
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
DF
# then in .env:
#   FFMPEG_PATH=<project>/scripts/ffmpeg-docker.sh
#   FFPROBE_PATH=<project>/scripts/ffprobe-docker.sh
```

The renderer checks for the filter before it starts and refuses with a clear
message rather than wasting an encode.

### 5. Apply migrations

```bash
pnpm db:migrate
```

This creates the schema and enables the `vector` extension.

### 6. Generate

```bash
# The whole pipeline: topic, script, scene plan, visual briefs and images
pnpm dev generate --category "personal finance" --audience "first-time investors"

# One step at a time
pnpm dev topic  --category "personal finance"
pnpm dev script --correlation-id <uuid-from-the-topic-run>
pnpm dev scene  --correlation-id <uuid-from-the-script-run>
pnpm dev image  --correlation-id <uuid-from-the-scene-run>
pnpm dev voice  --correlation-id <uuid-from-the-image-run>
pnpm dev render --correlation-id <uuid-from-the-voice-run>

# Continue runs that were interrupted
pnpm dev resume --limit 5
```

Every command writes newline-delimited JSON to stdout. Pipe it through `jq` if
you want it readable:

```bash
pnpm dev topic 2>&1 | jq -c '{level, message, correlationId}'
```

---

## CLI reference

| Command    | What it does                                                   |
| ---------- | -------------------------------------------------------------- |
| `generate` | Runs the pipeline as far as it is built (currently scene plan) |
| `topic`    | Produces one unique topic and stops                            |
| `script`   | Produces the script, generating the topic first if needed      |
| `scene`    | Produces the scene plan, generating what precedes it if needed |
| `image`    | Produces one image per scene, generating what precedes it too  |
| `voice`    | Produces `narration.mp3` and `subtitle.srt`                    |
| `resume`   | Continues runs that were interrupted                           |

| Option                  | Default                           | Applies to |
| ----------------------- | --------------------------------- | ---------- |
| `--category <text>`     | `general knowledge`               | all        |
| `--language <code>`     | `en`                              | all        |
| `--audience <text>`     | `a general audience`              | all        |
| `--duration <seconds>`  | `SCRIPT_TARGET_DURATION_SECONDS`  | all        |
| `--style <text>`        | `cinematic`                       | all        |
| `--aspect-ratio <w:h>`  | derived from `IMAGE_WIDTH/HEIGHT` | all        |
| `--correlation-id <id>` | —                                 | all        |
| `--limit <number>`      | `5`                               | `resume`   |

Exit codes: `0` success, `1` failure, `2` usage error.

---

## Run with Docker

The compose file defines two services: `postgres` and `app`.

```bash
cp .env.example .env      # set AI_API_KEY, then:
docker-compose up --build
```

Inside the compose network the database is reachable as `postgres:5432`, so
compose overrides `DATABASE_URL` for the `app` service — you do not need to
change it in `.env`.

Apply migrations against the containerised database:

```bash
docker-compose run --rm app npx prisma migrate deploy
```

Run a single command instead of the default `generate`:

```bash
docker-compose run --rm app node dist/main.js topic --category "history"
```

The image is multi-stage: dependencies, build, pruned production dependencies,
runtime. It contains the compiled JavaScript, the generated Prisma client, the
prompt files and production dependencies — nothing else. Generated media lives
in a named volume, never in the image and never in the repository.

---

## Development

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `pnpm dev <cmd>`     | Runs the CLI from source with `tsx`                      |
| `pnpm build`         | Generates the Prisma client and compiles to `dist/`      |
| `pnpm start <cmd>`   | Runs the compiled build                                  |
| `pnpm typecheck`     | Type checks without emitting                             |
| `pnpm lint`          | ESLint, including the architecture boundary rules        |
| `pnpm format`        | Prettier                                                 |
| `pnpm test`          | Vitest — unit always, integration when a database exists |
| `pnpm test:coverage` | Vitest with V8 coverage                                  |
| `pnpm verify`        | lint + typecheck + test, the pre-merge gate              |
| `pnpm db:up`         | Starts PostgreSQL                                        |
| `pnpm db:down`       | Stops it                                                 |
| `pnpm db:migrate`    | Creates and applies a migration                          |
| `pnpm db:studio`     | Opens Prisma Studio                                      |

Integration tests skip themselves when `DATABASE_URL` is absent, so `pnpm test`
passes on a machine without Docker. They never call the AI router.

---

## Architecture

Six layers, in one direction only:

```
Controller → Use Case → Workflow → Agent → Repository → Service → External System
```

This is enforced, not just documented: `eslint.config.js` declares which layers
each directory may import, so a violation fails `pnpm lint` rather than review.

| Directory          | Responsibility                                              |
| ------------------ | ----------------------------------------------------------- |
| `src/controllers`  | Translate input into a use-case call. No business logic.    |
| `src/use-cases`    | One business operation each. Coordinate workflows.          |
| `src/workflows`    | Execution order, retry, resume, workflow state.             |
| `src/agents`       | Business decisions. One responsibility each.                |
| `src/repositories` | CRUD against PostgreSQL. The only layer that sees Prisma.   |
| `src/services`     | One external system each. No business logic.                |
| `src/database`     | Prisma schema, migrations, connection, enum mapping.        |
| `src/config`       | The only place that reads `process.env`.                    |
| `src/dto`          | Typed payloads exchanged between layers.                    |
| `src/types`        | Domain enums, ports, typed errors.                          |
| `src/utils`        | Logger, retry policy, correlation ids.                      |
| `src/prompts`      | Prompt templates. Never hard-coded in TypeScript.           |
| `output/`          | Disposable media. Deleted after a verified upload.          |
| `tests/`           | `unit/` (fully mocked) and `integration/` (needs Postgres). |

`src/composition-root.ts` is the single place allowed to call `new`. Everything
else receives its collaborators through its constructor.

### Recovery

Every step writes a row to `workflow_step_runs` before and after it runs. A
resumed run repeats nothing that already succeeded:

```bash
pnpm dev generate --correlation-id <uuid>   # continue one specific run
pnpm dev resume                              # continue everything unfinished
```

A run that stopped deliberately at a requested step is marked finished and is
not picked up by `resume`. A crashed run has no `finished_at` and is.

### Errors

No generic `Error` is ever thrown. Every failure carries a `code`, a `message`,
a `retryable` flag and `details`. Only retryable failures are attempted again:
the workflow retries steps, and the AI router retries transport failures.

### Prompts

Prompts live in `src/prompts` as Markdown with `{{placeholders}}`. A missing
value is an error rather than a placeholder sent verbatim to a model. Add
`topic.v2.md` alongside `topic.md` to version a prompt without invalidating the
runs produced by the previous wording.

---

## Configuration

Full reference: `.env.example`. Notable entries:

| Variable                       | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `AI_BASE_URL`                  | Router endpoint. Never hard-coded in source.    |
| `AI_MODEL`                     | Model alias. Switching models is an env change. |
| `AI_TIMEOUT`, `AI_MAX_RETRIES` | Transport timeout and retry budget.             |
| `WORKFLOW_MAX_RETRIES`         | Retries per workflow step.                      |
| `WORKFLOW_BACKOFF_MS`          | Backoff per retry, comma separated.             |
| `TOPIC_MAX_ATTEMPTS`           | Candidate topics tried before giving up.        |
| `TOPIC_SIMILARITY_THRESHOLD`   | Cosine similarity that counts as a duplicate.   |
| `LOG_LEVEL`, `LOG_PERSIST`     | Verbosity, and whether logs go to PostgreSQL.   |
| `OUTPUT_DIR`, `PROMPTS_DIR`    | Scratch directory and prompt directory.         |

---

## Troubleshooting

**`Environment validation failed`** — the details list every variable that was
rejected and why. Compare `.env` against `.env.example`.

**`9 Router responded with status 401`** — `NINE_ROUTER_API_KEY` is missing or
wrong.

**Subtitles drift from the audio** — they should not: the Voice Agent speaks
each narration block separately, measures the clip with ffprobe and joins the
clips with exactly the silence the plan asks for, so the captions and the audio
are built from the same numbers. Compare `timelineDurationSeconds` with
`assembledDurationSeconds` in the `VOICE` success record; they agree to within
one MP3 frame.

`NARRATION_WORDS_PER_MINUTE` no longer affects caption timing. It only decides
how much text the planner puts in a block, so a wrong value gives blocks that
are longer or shorter than intended, never captions that slide out of sync.

**Images are not appearing** — check `output/workflows/{workflowId}/images`.
The workflow id is the `workflowRunId` in the logs, not the correlation id.

**`AI_RETRIES_EXHAUSTED` on the `IMAGE` step, with a 502** — the router has no
working image provider for `NINE_ROUTER_IMAGE_COMBO`. Confirm with:

```bash
curl -s "$NINE_ROUTER_BASE_URL/images/generations" \
  -H "authorization: Bearer $NINE_ROUTER_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"'"$NINE_ROUTER_IMAGE_COMBO"'","prompt":"a red lighthouse","n":1}'
```

A reply such as `Provider 'x' does not support image generation` means the combo
points at text models. Connect an image-capable provider in the router and point
the combo at it. Until then, either configure the fallback below or set
`PIPELINE_LAST_STEP=SCENE`.

**Image fallback (optional).** Set `HUGGINGFACE_API_KEY` and the Image Agent
asks Hugging Face for any image the router could not produce. It stays a
fallback: the router is tried first for every scene, and the fallback is only
reached after the router has spent its own retry budget. Leave the key empty and
the fallback does not exist.

`HUGGINGFACE_IMAGE_MODEL` is a provider route — the first segment names the
inference provider, the rest is that provider's model id, e.g.
`fal-ai/fal-ai/flux/dev` for FLUX.1-dev. Which providers serve a model changes
without notice; list the current ones with:

```bash
curl -s -H "Authorization: Bearer $HUGGINGFACE_API_KEY" \
  "https://huggingface.co/api/models/black-forest-labs/FLUX.1-dev?expand[]=inferenceProviderMapping"
```

The retired `api-inference.huggingface.co` host answers `410 The requested model
is deprecated` for these models — `HUGGINGFACE_BASE_URL` must point at
`https://router.huggingface.co`.

Which provider made each image is recorded in `scene_images.combo`, so a run
served partly by each is readable from the metadata alone.

**`IMAGE_PROVIDER_REQUEST_FAILED` with status 402** — `You have depleted your
monthly included credits`. Hugging Face bills these calls against the account's
inference credits and one video needs one image per scene, so a free account
runs out quickly. Buy pre-paid credits, subscribe to PRO, or clear
`HUGGINGFACE_API_KEY` to turn the fallback off.

**`port is already allocated` on `pnpm db:up`** — change `POSTGRES_PORT` in
`.env` and update the port inside `DATABASE_URL` to match.

**Integration tests are skipped** — `DATABASE_URL` is not set, or `.env` is
missing. They read `.env` through dotenv.

**`prisma migrate dev` complains about a shadow database** — either leave
`SHADOW_DATABASE_URL` unset so Prisma manages one itself, or create the
database it names.
