# Syncro — 3-Minute Live Demo Script

The exact click-path for a live demo. Total runtime target: 3:00. Every step names what to do, what to say, and what the audience should see. The running app: **https://0gxlvpm00w-8823.hosted.obvious.ai**

| Time | Segment |
|---|---|
| 0:00–0:25 | Setup & hook |
| 0:25–1:00 | Import + trim |
| 1:00–1:50 | Object removal with A/B |
| 1:50–2:25 | Style Bible |
| 2:25–2:50 | 3D insert |
| 2:50–3:00 | Export & close |

---

## Pre-demo checklist (do this before the audience sees the screen)

- [ ] All API keys entered in the key-entry UI (⚙ key panel): **Gemini**, **fal.ai**, **Meshy** (Groq optional — free at console.groq.com — and Meshy/Tripo as backup providers). Verify each shows as configured; a missing key mid-demo is the one failure mode you cannot talk through.
- [ ] Sample clip staged and ready to drag in — 10–20 seconds, one clear, static-ish object in frame (a cup, a chair, a sign), decent lighting, minimal camera motion. Watch it once locally to know where the object sits.
- [ ] Browser zoomed to ~150%, only the Syncro tab open, notifications silenced, browser in fullscreen.
- [ ] Rendered output from a rehearsal export still on disk as a safety net if anything hangs.
- [ ] Tab audio unmuted if you plan to play generated voiceover; otherwise muted.

## The script

### 0:00 — Setup & hook (0:25)

Open the live app. Say:

> "This is Syncro — a video editor that runs entirely in the browser. Every edit here is a timestamped operation applied on top of your footage — nothing is baked in until export, and the export matches the preview exactly, because both are rendered by the same code."

Point at the timeline and the dark NLE layout — one sentence, then move.

### 0:25 — Import + trim (0:35)

1. Drag the sample clip into the app. Wait for it to appear on the timeline with its waveform.
2. Drag the trim handles to cut a few seconds off the start.
3. **Say:** "Trims, moves, transitions — every one of these is recorded as an EditOp with in and out points. I can undo all of it and the original footage comes back untouched." Press undo once, then redo, to prove it.

### 1:00 — Object removal with A/B (0:50)

1. Open the **Object Surgery** panel. Set the time range to cover a few seconds where the object is clearly visible.
2. Click the object in the extracted frame.
3. Run the op. **Say:** "This isolates just that time range, segments the object with SAM 2, and inpaints the background with VOID — the frames outside the range are never regenerated, so the splice stays clean."
4. When the result lands, toggle **A/B** between original and result. Let the audience see the object vanish and return.
5. **Say:** "If I don't like the generation, I delete the op — the original footage is byte-identical." (Don't delete it; leave it applied.)

### 1:50 — Style Bible (0:35)

1. Open the **Style Bible** panel. Type a style prompt, e.g. *"warm, cinematic, slightly desaturated, film-look"* and generate.
2. **Say:** "One JSON spec — grade, caption typography, transitions, pacing — generated once, applied to every clip. Preview and export read the same spec, so what I see is what exports."
3. Apply it and let the look sweep over the preview. Optionally show a range-exemption: exempt a short range so a portion keeps its original grade.

### 2:25 — 3D insert (0:25)

1. In the **3D** panel, pick a frame and generate a 3D asset from it (Meshy).
2. When the GLB loads in the embedded three.js editor, drag to rotate it once, scale it, then place it as an overlay over a time range.
3. **Say:** "Frame to 3D, edited in-browser, composited over the range — graded by the same Style Bible." Keep this segment moving; generation latency is the risk, so narrate over it.

### 2:50 — Export & close (0:10)

1. Click **Export**. Point at the progress state.
2. **Say:** "The export replays the same op journal through the same frame evaluator as the preview — trims, object removal, grade, 3D — all of it burned in deterministically. The exported file is the authoritative render." End on the timeline: "Everything you saw took three minutes and survives export."

## Recovery moves (if something misbehaves)

- **A generation is slow (>30s):** narrate the architecture while it spins — the EditOp journal and shared render pipeline explain themselves. Hard cut to the A/B toggle when it lands.
- **A generation fails:** it appears in the log panel — use it: "It fails loudly and the op can be retried or deleted; the footage is never corrupted." Then fall back to the rehearsal export as a last resort.
- **Demo machine dies:** open the hosted URL on any machine, re-enter keys from the checklist, and the project state is the staged clip only — restart at Import; the segments are independent enough to truncate safely.
