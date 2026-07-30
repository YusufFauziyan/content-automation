# CLAUDE.md

# Yu-tomation

AI Engineering Guidelines

Version: 1.0

---

# Mission

You are contributing to **Yu-tomation**, an AI-powered content automation platform.

Your responsibility is not only to write working code.

Your responsibility is to preserve architecture consistency,
maintainability,
and long-term scalability.

Whenever multiple implementations are possible,
always choose the one that produces the cleanest architecture.

---

# Project Vision

Yu-tomation automatically creates short-form videos.

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

Video Composition

↓

Quality Validation

↓

Upload

↓

Cleanup

↓

Metadata Storage

Media is temporary.

Knowledge is permanent.

---

# Core Philosophy

Always remember

Stateless Media

Stateful Knowledge

Generated files are disposable.

Knowledge must survive forever.

Never design features that require permanent media storage.

---

# Architecture First

Architecture is more important than implementation.

Never bypass layers.

Correct flow

Controller

↓

Use Case

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

Never skip a layer.

Never access Prisma inside Agents.

Never access external APIs inside Repositories.

Never place business logic inside Services.

---

# Single Responsibility

Every class has exactly one responsibility.

Every Agent solves exactly one problem.

Every Repository owns exactly one aggregate.

Every Service integrates exactly one external dependency.

Never combine unrelated responsibilities.

---

# Business Logic

Business logic belongs only inside

Agents

Use Cases

Never place business rules inside

Controllers

Repositories

Services

Configuration

---

# Dependency Injection

Always inject

Repositories

Services

Configuration

Bad

new TopicRepository()

new ClawService()

Good

constructor(
private readonly topicRepository: TopicRepository,
private readonly clawService: ClawService
)

---

# Database

Database

PostgreSQL

ORM

Prisma

Repositories are the only layer allowed to access Prisma.

Never use raw SQL unless absolutely necessary.

Always create migrations.

Never modify production schema manually.

---

# Duplicate Prevention

Before generating a topic

Always

Check exact title

↓

Generate embedding

↓

Search semantic similarity

↓

Reject duplicated topics

↓

Generate another topic

Semantic similarity is mandatory.

---

# Workflow

Workflow owns

Execution Order

Retry

Resume

Cleanup

Workflow State

Agents never call other agents.

---

# Workflow Recovery

Every completed step must update workflow status.

Possible states

TOPIC_CREATED

SCRIPT_CREATED

SCENE_CREATED

IMAGES_CREATED

VOICE_CREATED

SUBTITLE_CREATED

VIDEO_CREATED

UPLOAD_COMPLETED

If application crashes

Resume from latest successful step.

Never restart from the beginning.

---

# AI Communication

Agents communicate only through DTOs.

Never exchange markdown.

Never exchange plain strings.

Always use strongly typed objects.

---

# Prompt Management

Never hardcode prompts.

Every prompt belongs inside

/prompts

Prompt names

topic.md

script.md

scene.md

image.md

thumbnail.md

voice.md

Prompt versioning is encouraged.

---

# Error Handling

Never throw generic Error.

Always create typed errors.

Every error must include

Code

Message

Retryable

Details

Workflow decides whether retry is allowed.

---

# Retry Strategy

Retry only retryable errors.

Maximum retries

3

Backoff

1 second

3 seconds

10 seconds

---

# Logging

Every workflow step logs

START

SUCCESS

FAILED

Execution Time

Retry Count

Correlation ID

Workflow ID

Never use console.log in production.

Always use Logger.

---

# Media Lifecycle

Generate

↓

Render

↓

Upload

↓

Verify Upload

↓

Delete

Never keep generated media.

Delete

PNG

JPG

WEBP

MP3

WAV

MP4

MOV

SRT

Temporary JSON

Keep only metadata.

---

# Metadata

Persist

Topics

Scripts

Captions

Hashtags

Scene JSON

Thumbnail Prompt

Workflow State

Upload URL

Embeddings

Logs

Never persist

Images

Videos

Audio

Subtitle files

---

# Repository Rules

Repositories

Create

Read

Update

Delete

Nothing else.

Repositories never

Call AI

Call HTTP

Generate prompts

Render media

---

# Service Rules

Services communicate only with

OpenClaw

Claude

ComfyUI

FLUX

Kokoro

Whisper

FFmpeg

Playwright

Filesystem

Services never contain business logic.

---

# Agent Rules

Each Agent

Has one responsibility

Produces deterministic output

Uses DTOs

Can be tested independently

Has no infrastructure knowledge

---

# Performance

Parallel execution

Image Generation

Voice Generation

Thumbnail Generation

Sequential execution

Topic

Script

Scene Planning

Rendering

Upload

Only parallelize independent work.

---

# Code Style

Prefer

Readable code

Small classes

Small functions

Pure functions

Composition

Dependency Injection

Repository Pattern

Avoid

Large classes

Static utility abuse

Global mutable state

Magic strings

Magic numbers

---

# TypeScript

Strict mode enabled.

Never use

any

Prefer

unknown

Generics

Enums

Readonly

Discriminated unions

Strong typing everywhere.

---

# Environment Variables

Never hardcode

API Keys

Passwords

Ports

URLs

Model IDs

Everything configurable belongs inside

.env

Validate configuration during application startup.

---

# Prisma

Use Prisma Client.

Always create migrations.

Never edit generated files.

Never query Prisma outside repositories.

---

# Testing

Every feature requires

Unit Test

Integration Test

Mock external systems

Never call production APIs during tests.

---

# Documentation

Every public class

Must include JSDoc.

Every Agent documents

Purpose

Input

Output

Dependencies

Every Repository documents

Tables

Queries

Methods

---

# Preferred Development Flow

1

Understand the architecture.

2

Read existing code.

3

Reuse existing abstractions.

4

Implement feature.

5

Write tests.

6

Run lint.

7

Run build.

8

Update documentation if necessary.

---

# Before Writing Code

Always ask

Can existing code be reused?

Would this violate architecture?

Is this responsibility already owned by another class?

Does this increase coupling?

Can this be tested independently?

If any answer is problematic,

redesign before coding.

---

# If Unsure

When multiple implementations are possible,

Always choose the implementation that

- reduces coupling
- improves readability
- follows the existing architecture
- minimizes future maintenance
- maximizes testability

Never optimize prematurely.

Architecture consistency is always more important than writing fewer lines of code.

---

# Final Rule

Yu-tomation is a long-term project.

Write code as if another engineer—or another AI—will maintain it for years.

Every decision should improve clarity, predictability, and maintainability.

If you cannot explain why a design is better, do not implement it.
