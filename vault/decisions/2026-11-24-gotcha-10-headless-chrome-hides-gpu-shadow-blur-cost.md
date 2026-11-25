---
type: adr
date: 2026-11-24
status: closed
tags: [gotcha, map, performance]
related:
  - "[[2026-11-24-1829-hub-hover-perf]]"
  - "[[2026-11-23-decision-14-the-map-is-drawn-on-one-canvas]]"
---

# Gotcha 10 — headless Chrome hides what shadow blur costs on a GPU

## What happens

The map's frame checks ran in headless Chromium, which draws canvas in software. There
`shadowBlur` is cheap. In a real browser canvas is drawn on the GPU, and every draw call with a
shadow blur is its own blur pass. Hovering the biggest hub on the 5,000-item map drew each of up
to 400 neighbours and 160 firing pulses as separate blurred calls: about 16 ms a frame headless,
about 250 ms a frame in headed Chrome at retina density. The headless check passed while the real
map stuttered.

## What we did

The renderer batches the neighbours (per kind, colour, alpha and outline, cached) and the pulses
(per colour), so each batch is one blurred draw. A new check, `web/e2e/hub-map-perf.spec.ts`,
runs at `deviceScaleFactor: 2` with `--enable-gpu --ignore-gpu-blocklist` (plus
`--use-angle=metal` on a Mac); it fails on the old renderer and passes on the new one.

## Rule

Never set `shadowBlur` inside a per-dot or per-link loop: batch the shapes into one `Path2D` and
blur once. A frame check for anything drawn with blur, filters or large composites must run with
GPU rasterisation, or it measures the wrong machine. Off a Mac the GPU flags may not take effect.
