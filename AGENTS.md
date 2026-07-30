# AGENTS.md

# Yu-tomation

AI Content Automation Platform

Version: 2.0

---

# Project Goal

Yu-tomation automatically creates and publishes short-form content.

Pipeline

Topic

↓

Script

↓

Scene Planning

↓

Image Generation

↓

Voice Generation

↓

Subtitle Generation

↓

Video Rendering

↓

Quality Validation

↓

Upload

↓

Cleanup

↓

Store Metadata

The application is modular.

Every Agent owns ONE responsibility.

---

# Tech Stack

Language

- TypeScript

Runtime

- Node.js

Package Manager

- pnpm

Database

- PostgreSQL

ORM

- Prisma

Vector Search

- pgvector

LLM Router

- OpenClaw

Primary Model

- Claude Opus

Image Generation

- ComfyUI
- FLUX

Voice

- Kokoro TTS

Subtitle

- Faster Whisper

Video Rendering

- FFmpeg

Automation

- Playwright

Container

- Docker Compose

---

# Architecture

```
Controller

↓

Workflow

↓

Agent

↓

Repository

↓

Service

↓

External System
```

Agents never communicate directly with external APIs.

Agents never access Prisma directly.

---

# Folder Structure

```
yu-tomation/

│

├── src/

│

├── agents/

│   ├── topic.agent.ts
│   ├── script.agent.ts
│   ├── scene.agent.ts
│   ├── image.agent.ts
│   ├── voice.agent.ts
│   ├── subtitle.agent.ts
│   ├── composer.agent.ts
│   ├── qa.agent.ts
│   ├── upload.agent.ts
│   └── cleanup.agent.ts

│

├── repositories/

│   ├── topic.repository.ts
│   ├── content.repository.ts
│   ├── workflow.repository.ts
│   ├── upload.repository.ts
│   ├── embedding.repository.ts
│   └── log.repository.ts

│

├── services/

│   ├── claw.service.ts
│   ├── comfy.service.ts
│   ├── kokoro.service.ts
│   ├── whisper.service.ts
│   ├── ffmpeg.service.ts
│   ├── playwright.service.ts
│   └── embedding.service.ts

│

├── database/

│   ├── prisma/
│   │     schema.prisma
│   │
│   └── migrations/

│

├── prompts/

│   ├── topic.md
│   ├── script.md
│   ├── scene.md
│   ├── image.md
│   ├── thumbnail.md

│

├── workflows/

│   ├── generate.workflow.ts
│   └── retry.workflow.ts

│

├── config/

├── types/

├── utils/

├── output/

└── main.ts
```

---

# Agent Rules

Every Agent

- Has ONE responsibility
- Receives DTO input
- Returns DTO output
- Never performs SQL
- Never calls Prisma
- Never calls external APIs directly
- Never writes files directly
- Never knows other Agent implementation

Agents coordinate business logic only.

---

# Repository Rules

Repositories are responsible only for

- Create
- Read
- Update
- Delete

Repositories are the ONLY layer allowed to use Prisma.

Agents must never access Prisma.

---

# Service Rules

Services communicate with

- OpenClaw
- ComfyUI
- Kokoro
- Whisper
- FFmpeg
- Playwright
- File System

Services never contain business logic.

---

# Workflow Rules

Workflow coordinates all agents.

Workflow decides

Next Step

Retry

Resume

Cleanup

Agents never call other agents.

---

# Agent Responsibilities

---

## Topic Agent

Responsibilities

- Generate candidate topic
- Search PostgreSQL
- Search semantic similarity
- Reject duplicate topics
- Return unique topic

Uses

TopicRepository

EmbeddingRepository

EmbeddingService

Must NOT

Generate script

---

## Script Agent

Responsibilities

Generate

- Title
- Script
- Caption
- Hashtags
- Thumbnail Prompt

Uses

ClawService

Must NOT

Generate images

---

## Scene Agent

Responsibilities

Split script into scenes.

Return

Scene JSON

Example

Scene

Duration

Prompt

Transition

Camera

---

## Image Agent

Responsibilities

Generate scene images.

Uses

ComfyUI

Output

PNG

Never render video.

---

## Voice Agent

Responsibilities

Generate narration.

Uses

Kokoro

Output

voice.mp3

---

## Subtitle Agent

Responsibilities

Generate subtitles.

Uses

Faster Whisper

Output

subtitle.srt

---

## Composer Agent

Responsibilities

Combine

Images

Voice

Subtitle

Music

Uses

FFmpeg

Output

video.mp4

---

## QA Agent

Responsibilities

Validate

Aspect Ratio

Resolution

Subtitle

Duration

Audio

Scene Count

Return

PASS

or

FAIL

---

## Upload Agent

Responsibilities

Upload

TikTok

Uses

Playwright

Return

Video URL

Upload Status

---

## Cleanup Agent

Responsibilities

Delete

Images

Audio

Subtitle

Video

Temporary Files

Never delete

Metadata

Logs

Database

---

# Database

Store only

Topics

Scripts

Captions

Hashtags

Thumbnail Prompt

Scene JSON

Workflow State

Embeddings

Upload URLs

Logs

Never store

Images

Videos

Audio

Subtitle

---

# Workflow State

Every step updates

workflow table

Example

TOPIC_DONE

SCRIPT_DONE

SCENE_DONE

IMAGE_DONE

VOICE_DONE

SUBTITLE_DONE

VIDEO_DONE

UPLOAD_DONE

If application crashes

Resume from latest successful step.

Never restart the pipeline.

---

# Embedding Rules

Every topic must generate embedding.

Store using

pgvector

Before creating topic

Search similarity.

If similarity exceeds threshold

Reject topic.

Generate another.

---

# Cleanup Rules

Cleanup happens only after

Upload Success

Delete

PNG

JPG

WEBP

MP3

WAV

MP4

MOV

SRT

JSON cache

Keep

Database

Logs

Embeddings

---

# Logging

Every Agent logs

START

SUCCESS

FAILED

Duration

Retry Count

Correlation ID

Use structured logging.

Never use console.log in production.

---

# Error Handling

Agents return

{
success,
data,
error
}

Never throw generic Error.

---

# Retry Policy

Retry

Maximum

3

Backoff

1s

3s

10s

Only retry retryable errors.

---

# Communication Rules

Agents communicate only through DTOs.

Never exchange markdown.

Never exchange plain strings.

Always return typed objects.

---

# Dependency Injection

Always inject

Repositories

Services

Configuration

Never instantiate dependencies manually.

Good

constructor(
private readonly topicRepository: TopicRepository,
private readonly clawService: ClawService
)

Bad

new TopicRepository()

new ClawService()

---

# AI Rules

Always produce structured JSON.

Never generate duplicated content.

Never ignore workflow state.

Always validate before upload.

Always delete media after successful upload.

Always preserve knowledge.

---

# Final Principle

Yu-tomation follows one philosophy.

Stateless Media.

Stateful Knowledge.

Generated media is disposable.

Knowledge is permanent.

Every new feature must preserve this architecture.
