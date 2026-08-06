# ARCHITECTURE.md

# Yu-tomation

System Architecture

Version 1.0

---

# Overview

Yu-tomation is an AI-powered content automation platform.

The system automatically generates and publishes short-form videos for TikTok.

The application follows a layered architecture with strict separation of responsibilities.

Business logic must remain independent from infrastructure.

Generated media is temporary.

Knowledge is permanent.

---

# Design Principles

The architecture is based on:

- Single Responsibility Principle
- Dependency Injection
- Repository Pattern
- Stateless Media
- Stateful Knowledge
- Recoverable Workflow
- Event-driven State Updates
- Strong Type Safety

---

# High Level Architecture

                    User / Scheduler
                           │
                           ▼
                    Generate Workflow
                           │
                           ▼
                    Workflow Controller
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
    Topic Agent      Script Agent      Scene Agent
                           │
                           ▼
                  Parallel Execution
        ┌──────────────┬──────────────┐
        ▼              ▼              ▼

Image Agent Voice Agent Thumbnail Agent
│ │
└───────┬──────┘
▼
Subtitle Agent
▼
Composer Agent
▼
QA Agent
▼
Upload Agent
▼
Cleanup Agent
▼
PostgreSQL

---

# Layered Architecture

The project consists of six layers.

Controller

↓

Workflow

↓

Agents

↓

Repositories

↓

Services

↓

External Systems

Each layer has one responsibility.

No layer may skip another layer.

---

# Controller Layer

Responsibilities

- Receive CLI command
- Receive Scheduler event
- Start workflow
- Handle graceful shutdown

Must NOT

- Generate content
- Access database
- Call AI models

---

# Workflow Layer

Responsibilities

- Coordinate execution
- Manage retries
- Manage workflow state
- Resume failed jobs
- Execute cleanup

Workflow never performs business logic.

Workflow only orchestrates agents.

---

# Agent Layer

Agents contain business logic.

Responsibilities

- Make decisions
- Validate outputs
- Build DTOs
- Execute use cases

Agents never

- Execute SQL
- Call Prisma
- Call HTTP directly
- Read environment variables
- Render video

Agents depend only on

Repositories

Services

Configuration

---

# Repository Layer

Repositories abstract PostgreSQL.

Responsibilities

Create

Read

Update

Delete

Repositories never

Generate prompts

Call AI

Render media

---

# Service Layer

Services communicate with external systems.

Examples

Claw Service

ComfyUI Service

Whisper Service

Speech Service

FFmpeg Service

Playwright Service

Embedding Service

Services never contain business logic.

---

# External Systems

OpenClaw

Claude Opus

↓

ComfyUI

↓

9 Router TTS

↓

Faster Whisper

↓

FFmpeg

↓

TikTok

---

# End-to-End Workflow

Step 1

Generate Topic

↓

Check duplicate

↓

Store topic

↓

Generate script

↓

Split scenes

↓

Generate images

↓

Generate voice

↓

Generate subtitles

↓

Render video

↓

Validate output

↓

Upload

↓

Verify upload

↓

Delete media

↓

Finish

---

# Parallel Execution

The following tasks may execute simultaneously.

Image Generation

Voice Generation

Thumbnail Generation

Everything else executes sequentially.

Reason

Image generation is independent after scene planning.

Voice generation only depends on script.

---

# Workflow State

Every completed step updates PostgreSQL.

Example

TOPIC_CREATED

SCRIPT_CREATED

SCENE_CREATED

IMAGES_CREATED

VOICE_CREATED

SUBTITLE_CREATED

VIDEO_CREATED

UPLOAD_COMPLETED

If the application crashes

Resume from latest successful state.

Never restart the pipeline.

---

# Temporary Media Lifecycle

Generate

↓

Store inside output/

↓

Compose Video

↓

Upload

↓

Verify Upload

↓

Delete

Media is never stored permanently.

---

# Persistent Knowledge

Store

Topics

Scripts

Captions

Hashtags

Scene JSON

Thumbnail Prompt

Upload URL

Workflow Status

Embeddings

Logs

Never store

Images

Videos

Audio

Subtitle Files

---

# Duplicate Detection

Before generating a topic

Search exact title

↓

If found

Reject

↓

Else

Generate embedding

↓

Search semantic similarity

↓

If similarity exceeds threshold

Reject

↓

Generate another topic

This prevents semantic duplication.

---

# Database Architecture

PostgreSQL

↓

Prisma ORM

↓

Repositories

↓

Agents

Agents never use Prisma directly.

---

# Dependency Injection

All dependencies are injected.

Good

Agent

↓

Repository

↓

Service

Bad

Agent

↓

new Service()

Never instantiate infrastructure inside agents.

---

# Communication

Agents communicate only through DTOs.

Example

TopicDTO

ScriptDTO

SceneDTO

ImageDTO

UploadDTO

Never exchange markdown.

Never exchange plain text.

---

# Error Recovery

Every failure must return

Error Code

Retryable

Message

Workflow decides

Retry

or

Abort

Retry maximum

3

Exponential Backoff

---

# Logging

Every workflow step logs

Start

Success

Failure

Execution Time

Retry Count

Correlation ID

Logs are stored in PostgreSQL.

---

# Scalability

Current

Single workflow

Future

Multiple workers

Redis Queue

RabbitMQ

Multi-platform upload

Instagram

YouTube Shorts

Facebook Reels

No architectural changes should be required.

---

# Future Agents

The architecture is designed to support new agents without modifying existing agents.

Examples

Trend Research Agent

SEO Agent

Translation Agent

Comment Reply Agent

Analytics Agent

Voice Clone Agent

Thumbnail Optimizer

A/B Testing Agent

---

# Directory Architecture

src/

├── agents/

├── repositories/

├── services/

├── workflows/

├── prompts/

├── database/

├── config/

├── types/

├── utils/

└── main.ts

Every new feature must fit inside this structure.

---

# Guiding Principles

Always prefer

Composition over inheritance.

Dependency Injection over direct instantiation.

Repositories over raw SQL.

Structured DTOs over free-form strings.

Knowledge persistence over media persistence.

Recoverable workflows over one-shot execution.

If a new feature violates these principles, redesign the feature before implementing it.
