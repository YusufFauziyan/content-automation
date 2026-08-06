/**
 * Writes `narration_audios` rows for runs that finished before the table existed.
 *
 * Run once with `pnpm audio:backfill`. Safe to run again: it upserts, and it
 * skips any run whose narration file is no longer on disk.
 *
 * The companion to the `20260805120000_narration_audio` migration. Without it,
 * a run whose voice step succeeded before that migration can never be resumed —
 * the audio is on disk, but nothing records what it is, so the render plan
 * refuses for want of narration it already produced.
 *
 * The length is recomputed from the measured narration blocks rather than
 * probed, because that is exactly what the Voice Agent stored: the same
 * arithmetic on both sides, so a resumed run gets the number the original run
 * would have written.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import 'dotenv/config';

import { loadConfig } from '../src/config/config.loader.js';
import { createDatabase } from '../src/database/prisma.client.js';
import { AudioRepository } from '../src/repositories/audio.repository.js';
import { ROUTER_SPEECH_SPEED } from '../src/services/router-speech.service.js';
import { toTimelineLength } from '../src/agents/voice.agent.js';
import type { NarrationBlockDto } from '../src/dto/narration.dto.js';

const NARRATION_FILE = 'narration.mp3';
const MS_PER_SECOND = 1000;

const config = loadConfig();
const database = createDatabase(config.database);
const audioRepository = new AudioRepository(database);

const runs = await database.workflowRun.findMany({
  where: { contentId: { not: null } },
  select: { id: true, contentId: true },
});

let written = 0;
let skipped = 0;

for (const run of runs) {
  if (run.contentId === null) continue;

  const relativePath = join('audio', NARRATION_FILE);
  const absolutePath = join(config.media.outputDirectory, 'workflows', run.id, relativePath);
  const file = await stat(absolutePath).catch(() => null);

  if (file === null) {
    skipped += 1;
    continue;
  }

  const content = await database.content.findUnique({
    where: { id: run.contentId },
    select: { narrationPlan: true },
  });
  const blocks = (content?.narrationPlan ?? []) as unknown as NarrationBlockDto[];

  if (blocks.length === 0) {
    console.log(`  ${run.id.slice(0, 8)} has audio but no measured plan — skipped`);
    skipped += 1;
    continue;
  }

  await audioRepository.save({
    contentId: run.contentId,
    workflowRunId: run.id,
    fileName: NARRATION_FILE,
    relativePath,
    byteSize: file.size,
    mimeType: 'audio/mpeg',
    durationMs: Math.round(toTimelineLength(blocks) * MS_PER_SECOND),
    voice: config.routerSpeech.language,
    model: `${config.routerSpeech.modelPrefix}/${config.routerSpeech.language}`,
    speed: ROUTER_SPEECH_SPEED,
    // Unknown and unknowable now. Recorded as zero rather than invented: the
    // number is what a render cost, and nobody measured this one.
    generationDurationMs: 0,
  });

  console.log(
    `  ${run.id.slice(0, 8)}  ${String(file.size).padStart(8)} bytes  ${String(blocks.length)} blocks`,
  );
  written += 1;
}

console.log(`\n  wrote ${String(written)}, skipped ${String(skipped)} (no audio on disk)`);
await database.$disconnect();
