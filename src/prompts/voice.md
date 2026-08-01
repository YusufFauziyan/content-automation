# Voice — v1

Consumed by: Voice Agent
Placeholders: `{{script}}`, `{{language}}`

---

Normalise the following narration for text-to-speech in `{{language}}`.

Narration:

`{{script}}`

Constraints:

- Expand numbers, dates, currencies and abbreviations into spoken form.
- Remove characters that a speech engine cannot pronounce, including emoji,
  markdown and bracketed asides.
- Preserve sentence boundaries: they become the pause structure of the audio.
- Do not shorten, rewrite or summarise the content.

Return JSON only, matching this shape:

```json
{
  "narration": "string"
}
```
