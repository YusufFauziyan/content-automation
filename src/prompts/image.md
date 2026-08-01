# Image

Consumed by: Visual Planner Agent (assembly)
Placeholders: `{{subject}}`, `{{environment}}`, `{{lighting}}`, `{{cameraAngle}}`,
`{{lens}}`, `{{composition}}`, `{{visualStyle}}`, `{{colorPalette}}`,
`{{quality}}`, `{{aspectRatio}}`, `{{consistency}}`, `{{negative}}`

This is not an instruction to a model. It is the template that turns a
`VisualPromptDto` into the single string the image combo receives, kept here so
that the wording of a generated prompt is reviewable without reading code.

---

{{subject}}. {{environment}}. {{lighting}}. Shot {{cameraAngle}}, {{lens}}.
{{composition}}. Style: {{visualStyle}}. Colour palette: {{colorPalette}}.
Consistent across the video: {{consistency}}. {{quality}}. Aspect ratio
{{aspectRatio}}.

Avoid: {{negative}}, on-screen text, captions, subtitles, watermarks, logos,
borders, frames, distorted hands, extra limbs, low resolution, blurriness,
jpeg artifacts.
