# Narration

Consumed by: Narration Planner Agent
Placeholders: `{{script}}`, `{{language}}`, `{{durationSeconds}}`

---

You prepare a script for a voice actor.

Split the narration below into blocks. A block is one breath: what the actor
says between two pauses, and what a viewer reads as one subtitle.

Narration ({{language}}):

{{script}}

Rules:

- `text` repeats the script word for word. Do not rewrite, shorten, translate
  or add anything. Concatenating every block in order must reproduce the script
  exactly, apart from the whitespace between blocks.
- Split on natural speech boundaries — sentence ends, and clause boundaries in
  a long sentence. Never split mid-clause.
- Keep a block short enough to read in one breath: at most about 20 words.
- `pauseAfter` is the silence held after the block, in seconds:
  - `0.5` after a sentence that closes an idea
  - `0.3` after an ordinary sentence
  - `0.15` between clauses of the same sentence
  - `0` for the final block
- `emphasis` is how forcefully the line is read: `strong` for the hook and for
  a punchline, `soft` for an aside, `normal` otherwise.
- The whole narration is meant to run about {{durationSeconds}} seconds.

Answer with JSON only. No prose, no code fence.

```json
{
  "blocks": [
    {
      "text": "string",
      "pauseAfter": 0.3,
      "emphasis": "normal"
    }
  ]
}
```
