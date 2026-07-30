# PROJECT_RULES.md

# Yu-tomation

Development Standards

Version 1.0

---

# Project Philosophy

Yu-tomation is designed to be:

- Modular
- Maintainable
- Recoverable
- Deterministic
- AI-Friendly

The project must prioritize long-term maintainability over short-term convenience.

---

# General Rules

Always prefer

- Readability
- Small functions
- Strong typing
- Dependency Injection
- Composition
- Clear folder structure

Never sacrifice architecture for shorter code.

---

# Technology Stack

Language

- TypeScript

Runtime

- Node.js (LTS)

Package Manager

- pnpm

Database

- PostgreSQL

ORM

- Prisma

Vector Search

- pgvector

Automation

- Playwright

Image Generation

- ComfyUI
- FLUX

Voice

- Kokoro TTS

Subtitle

- Faster Whisper

Rendering

- FFmpeg

AI Router

- OpenClaw

Primary LLM

- Claude Opus

Container

- Docker Compose

---

# Folder Rules

Every file must belong to exactly one layer.

Allowed structure

src/

controllers/

use-cases/

workflows/

agents/

repositories/

services/

database/

config/

prompts/

dto/

types/

utils/

output/

tests/

Never create new root folders unless approved.

---

# Layer Responsibilities

Controller

Receive input.

Never contains business logic.

---

Use Case

Represents one business operation.

Coordinates one or more workflows.

Never accesses Prisma directly.

---

Workflow

Controls execution order.

Handles retries.

Handles workflow state.

Never calls external APIs directly.

---

Agent

Contains business logic.

One agent = one responsibility.

Never communicates with other agents directly.

---

Repository

Responsible only for CRUD.

Only repositories may access Prisma.

---

Service

Responsible only for infrastructure.

Examples

HTTP

Playwright

FFmpeg

Filesystem

OpenClaw

ComfyUI

Whisper

Kokoro

---

# Dependency Injection

Always inject

Repositories

Services

Configuration

Never instantiate dependencies manually.

Good

constructor(
private readonly topicRepository: TopicRepository
)

Bad

new TopicRepository()

---

# Naming Convention

Files

kebab-case

Examples

topic.agent.ts

generate-content.usecase.ts

workflow.repository.ts

Classes

PascalCase

Functions

camelCase

Variables

camelCase

Constants

UPPER_SNAKE_CASE

Interfaces

Do not prefix with I.

Enums

PascalCase

---

# DTO Rules

Agents communicate only through DTOs.

Never exchange

Markdown

Free-form strings

Anonymous objects

Always create DTOs.

Example

TopicDto

ScriptDto

SceneDto

UploadDto

---

# Prompt Rules

Every AI prompt belongs inside

/prompts

Never hardcode prompts inside TypeScript files.

Every prompt should have a version.

Example

script.v1.md

scene.v2.md

thumbnail.v1.md

---

# Database Rules

Database

PostgreSQL

ORM

Prisma

Never use raw SQL unless absolutely necessary.

Every schema change must use Prisma Migration.

Never modify production schema manually.

---

# Repository Rules

Repositories are the only layer allowed to access Prisma.

Repositories never

Generate prompts

Call external APIs

Contain business logic

---

# Service Rules

Services communicate with

OpenClaw

ComfyUI

Kokoro

Whisper

FFmpeg

Playwright

Filesystem

Services never make business decisions.

---

# Agent Rules

Each agent

Has one responsibility

Produces deterministic output

Uses DTOs

Can be tested independently

Never performs infrastructure work.

---

# Workflow Rules

Workflow is responsible for

Execution order

Retry

Resume

Cleanup

Status update

Agents never call other agents.

---

# Logging

Every important action must be logged.

Minimum fields

Timestamp

Correlation ID

Workflow ID

Agent

Duration

Status

Retry Count

Never use console.log in production.

---

# Error Handling

Never throw generic Error.

Always create typed errors.

Every error must contain

Code

Message

Retryable

Details

Example

{
code: "IMAGE_TIMEOUT",
retryable: true
}

---

# Retry Policy

Maximum retries

3

Backoff

1 second

3 seconds

10 seconds

Retry only retryable errors.

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

Never lose workflow progress.

---

# Duplicate Prevention

Before creating a topic

Check exact title.

Generate embedding.

Search semantic similarity.

Reject duplicated content.

Generate another topic.

---

# Media Rules

Generated media is temporary.

Allowed

output/

tmp/

Forbidden

Store media in PostgreSQL.

Store media permanently.

After successful upload

Delete

Images

Videos

Audio

Subtitle

Temporary JSON

Keep

Metadata

Logs

Embeddings

---

# File Rules

Generated files must never be committed.

.gitignore must include

output/

tmp/

\*.png

\*.jpg

\*.webp

\*.mp3

\*.wav

\*.mp4

\*.mov

\*.srt

---

# Environment Variables

Never hardcode

API Keys

Passwords

Ports

URLs

Model IDs

Always use

.env

Validate environment variables on startup.

---

# Testing

Every new feature requires

Unit Test

Integration Test

Mock external services.

Never call production APIs during tests.

---

# Performance

Run sequentially

Topic

Script

Scene Planning

Run in parallel

Image Generation

Voice Generation

Thumbnail Generation

Only parallelize when there are no dependencies.

---

# Git Rules

One feature per commit.

Never mix

Refactor

Bug Fix

Feature

Commit messages should be descriptive.

Examples

feat: add topic embedding repository

fix: retry image generation timeout

refactor: split upload workflow

---

# Documentation

Every public class requires JSDoc.

Every agent documents

Input

Output

Responsibilities

Side effects

Every repository documents

Purpose

Methods

Database tables

---

# Code Review Checklist

Before merging

✓ Build passes

✓ Tests pass

✓ Lint passes

✓ No duplicated code

✓ No hardcoded prompt

✓ No raw SQL

✓ No direct Prisma access outside repositories

✓ No business logic inside services

✓ No business logic inside controllers

✓ Workflow state updated correctly

✓ Temporary media cleaned up

---

# Final Principles

Always prefer

Small files

Small classes

Small functions

Explicit dependencies

Typed DTOs

Repository Pattern

Dependency Injection

Recoverable workflows

Knowledge persistence

Stateless media

If multiple implementations are possible, choose the one that produces the clearest architecture, the easiest testing, and the lowest long-term maintenance cost.
