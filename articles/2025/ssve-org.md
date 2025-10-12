---
title: "Building a Browser-Based Video Editor with FFmpeg.wasm"
date: "12-10-2025"
description: "Creating a fully functional video editor that runs entirely in your browser. From timeline drag-and-drop to complex FFmpeg filter chains, here's how I built SSVE - a simple yet powerful tool for quick video edits."
tags: ["video-editing", "ffmpeg", "webassembly", "react", "nextjs", "browser", "typescript"]
---

Picture this: you want to trim a video, add some text overlays, and mix in background music. Usually, you'd fire up a desktop application, wait for it to load, import your files, and hope you remember where all the buttons are. But what if you could just open a browser tab and start editing immediately? No installation, no server uploads, everything processed right on your machine.

That's the vision behind Super Simple Video Editor (SSVE) - a proof-of-concept that brings "professional" video editing capabilities to the browser. Built with Next.js, React, and the magic of FFmpeg.wasm, it demonstrates how far web technologies have come. You get a three-track timeline, drag-and-drop editing, text overlays with animations, and MP4 export with quality controls - all running client-side with zero server processing.

This project taught me a ton about WebAssembly limitations, the intricacies of FFmpeg filter chains, and the challenges of building a real-time video preview system in the browser. Let's dive into how it works, the technical hurdles I encountered, and the design patterns that made it possible.

## The Core Experience: Edit, Preview, Export

At its heart, SSVE is organized around a classic video editing workflow with a few key windows working in harmony:

- **Asset Library**: Upload and manage videos, images, and audio files. Each asset gets a thumbnail preview and duration display, making it easy to find what you need.
- **Timeline Editor**: A three-track system where you drag assets, trim clips by dragging edges, and arrange everything visually. The tracks are specialized - one for video/images, one for audio manipulation, and one for text overlays.
- **Preview Window**: Real-time playback with transport controls. Watch your edits as you make them, with proper fade effects and text overlay rendering.
- **Export Dialog**: Choose your resolution (720p, 1080p, or 4K) and quality settings, then export to MP4 with progress tracking.

The workflow is deliberately simple: upload files, drag them to the timeline, adjust as needed, preview, and export. But under the hood, there's a sophisticated state management system coordinating everything, and a complex FFmpeg pipeline that transforms your edits into a final video file.

## State Management: The Zustand Approach

One of the first challenges was figuring out how to manage all the moving parts. You've got assets, timeline clips, playback state, text overlays, and export settings all needing to stay in sync. I chose Zustand for its simplicity and performance - no boilerplate, no provider wrappers, just clean state updates.

The store structure mirrors the domain model closely. Assets contain file references and metadata. Tracks hold arrays of clips, each with its own trimming, volume, and fade settings. The playback state tracks current time, play/pause status, and duration. This separation makes it easy to reason about state changes and keeps components focused.

What I love about this approach is how naturally it handles complex operations. Want to split a clip at the playhead? The `splitClip` action finds the clip, calculates the relative time, creates two new clips with adjusted trim points, and updates the track - all in one atomic operation. No prop drilling, no callback chains, just direct state manipulation with predictable results.

## Timeline Mechanics: Drag, Trim, Snap

Building a functional timeline was surprisingly tricky. Users expect to drag clips around, resize them by pulling edges, and have everything snap to logical positions. Getting this to feel smooth required careful attention to mouse event handling and state updates.

The drag system works through mouse event listeners that track delta movements and convert pixels to timeline seconds based on the zoom level. When you drag a clip, the system checks for potential overlaps with other clips on the same track - if moving would cause a collision, the clip stays put. Similarly, the snap-to-position logic looks for nearby clip boundaries and magnetically pulls your clip to align perfectly.

Trimming is even more nuanced. When you drag the left edge, you're simultaneously changing the clip's start time, duration, and trim start position in the source asset. Drag the right edge, and you're adjusting duration and trim end. The math has to account for the asset's actual duration - you can't trim beyond what's available in the source file. And throughout all this, the preview window needs to stay in sync, updating video and audio playback to match the new clip boundaries.

One detail I'm particularly proud of: the playhead can be dragged along the timeline ruler for precise seeking. It's a small thing, but it makes the editor feel responsive and professional.

## The FFmpeg Pipeline: From Edits to Video

Here's where things get really interesting. When you hit export, the system needs to take your timeline full of clips, fades, text overlays, and audio adjustments, and turn it into a single MP4 file. This happens entirely in the browser using FFmpeg.wasm - a port of the full FFmpeg library compiled to WebAssembly.

The export process starts by loading all referenced assets into FFmpeg's virtual filesystem. Each video, image, and audio file gets written as `input_<assetId>`, making them available for processing. Then comes the complex part: building the FFmpeg filter chain.

For video, each clip goes through its own filter pipeline. Videos get trimmed to the correct segment, scaled to the target resolution with proper aspect ratio handling, and padded with black bars if needed. Images are looped to create the illusion of duration, then scaled and padded identically. Fade effects are applied using FFmpeg's fade filter at the appropriate timestamps.

The real complexity comes when concatenating everything together. FFmpeg's concat filter requires all inputs to have matching parameters, so every clip must be processed into a consistent format first. Then they're concatenated into a single video stream. If your audio extends beyond the video duration (say, a long music track), the system generates a black frame sequence to extend the video, applying a fade-to-black effect for a smooth transition.

Text overlays use FFmpeg's drawtext filter with careful timing enables. Each text clip knows its start time and duration, so the filter only renders when the overlay should be visible. The positioning uses percentage-based calculations that scale across different resolutions. Font loading was a challenge - the system tries to load a TrueType font file into FFmpeg's filesystem, falling back gracefully if unavailable.

Audio mixing combines volume adjustments, fade effects, and optional noise reduction. The track-level volume multiplies with clip-level volume to create the final mix. Speed adjustments (for slow-motion or time-lapse effects) modify playback rate while keeping audio in sync.

## Preview System: Rendering in Real-Time

Building a smooth preview experience proved to be one of the trickier aspects. The preview needs to show the current frame based on playback time, apply fade effects, render text overlays, and play synchronized audio - all while feeling responsive.

The system uses separate HTML video and image elements for the visual content, displaying whichever matches the current clip type. As playback time advances, the preview checks which clip should be active, loads its asset, and seeks to the correct position accounting for trim offsets. Fade in/out effects are applied via CSS opacity, calculated based on elapsed time within the clip.

Text overlays render on a transparent canvas positioned over the video. The canvas redraws every frame, checking which text clips are active at the current time, calculating their fade state, and using the Canvas API to render text with the specified font, size, color, and position. Background colors for text boxes are drawn as rectangles before the text itself.

Audio preview was particularly tricky. Unlike video, you can't just "seek" an audio element and have it instantly play from that position reliably. The system creates an audio element per track, loads the current clip's asset, applies volume and speed adjustments, and carefully synchronizes play/pause state with the video. Fade effects are applied in real-time by adjusting the audio element's volume property.

The playback loop uses `requestAnimationFrame` for smooth updates. When playing, it calculates elapsed time since the last frame, updates the current time state, and triggers all dependent systems to update accordingly. This architecture keeps the UI responsive even during intensive operations.

## Project Persistence: Save and Resume Later

One feature I wanted from the start was the ability to save your work and come back later. The challenge is that a video editing project isn't just data - it's files, lots of them. You can't just serialize the File objects and call it a day.

The save system converts all asset files to base64-encoded data URLs, then packages everything - tracks, clips, text overlays, export settings, and the encoded files - into a single JSON file with the `.ssve` extension. It's not the most space-efficient format, but it's simple and reliable.

Loading reverses the process: parse the JSON, convert base64 strings back to File objects, regenerate object URLs for preview, and restore thumbnails. For video assets, it even attempts to regenerate thumbnails by creating a video element, seeking to a representative frame, and capturing it to a canvas.

This approach means projects are completely self-contained. Share a `.ssve` file with someone, and they have everything needed to continue editing - no missing asset errors, no broken references. The trade-off is file size, but for quick edits with reasonable asset counts, it works beautifully.

## Design Lessons: Constraints and Compromises

Building SSVE taught me several valuable lessons about browser-based media editing:

**WebAssembly is powerful but has limits.** FFmpeg.wasm brings desktop-grade video processing to the browser, but it's slower than native FFmpeg and has memory constraints. Export times for longer videos can be significant. Users need clear progress feedback and realistic expectations about performance.

**State synchronization is everything.** With so many interconnected pieces - assets, clips, playback, preview - keeping everything in sync is crucial. A single source of truth (Zustand store) with clear update patterns prevented countless bugs. When preview and timeline disagreed, it was always a state sync issue.

**The timeline is the hardest part.** Getting drag-and-drop, resizing, snapping, and collision detection to feel natural required multiple iterations. Small details matter - the cursor changing to indicate resize mode, visual feedback during drags, smooth animations. Users have expectations from professional tools, and falling short is immediately noticeable.

**Progressive enhancement works.** Start with core functionality (load, arrange, export), then add polish (fade effects, text overlays, audio mixing). Each layer builds on the previous one. This approach kept development manageable and ensured a working product at every stage.

**Browser APIs aren't consistent.** File handling, video playback, audio synchronization - every browser has quirks. Defensive coding and graceful fallbacks are essential. The font loading system, for example, handles failures silently rather than breaking the entire export.

## Technical Deep Dive: The FFmpeg Filter Chain

Let me show you what an actual FFmpeg command looks like for a simple project with two video clips and a text overlay:

```bash
ffmpeg \
  -i input_clip1 \
  -i input_clip2 \
  -filter_complex "
    [0:v]trim=start=0:end=5,setpts=PTS-STARTPTS,fps=30,
    scale=1920:1080:force_original_aspect_ratio=decrease,
    pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,
    fade=t=in:st=0:d=0.5,fade=t=out:st=4.5:d=0.5[v0];
    
    [1:v]trim=start=0:end=5,setpts=PTS-STARTPTS,fps=30,
    scale=1920:1080:force_original_aspect_ratio=decrease,
    pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v1];
    
    [v0][v1]concat=n=2:v=1:a=0[vidout];
    
    [vidout]drawtext=fontfile=font.ttf:text='Hello World':
    fontsize=48:fontcolor=0xffffff:x=960-text_w/2:y=540:
    enable='between(t,0,5)'[vout]
  " \
  -map "[vout]" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -y output.mp4
```

This chain trims both clips, scales them to 1080p maintaining aspect ratio, pads with black bars if needed, applies fade effects to the first clip, concatenates them together, and renders text in the center. The system builds this programmatically from the timeline state, handling arbitrary numbers of clips, tracks, and overlays.

## Looking Forward: What's Next

SSVE is a proof-of-concept that demonstrates what's possible, but there's plenty of room for enhancement. Some ideas I'm considering:

**Multi-track audio mixing.** Currently, the audio track holds one clip at a time. Supporting multiple simultaneous audio sources with mixing would enable background music plus narration scenarios.

**Advanced effects library.** Transitions between clips (cross-dissolve, wipes), color grading filters, and video effects (blur, brightness, saturation) would expand creative possibilities. FFmpeg supports these, it's just a matter of building the UI.

**Waveform visualization.** Showing audio waveforms on the timeline makes precise audio editing much easier. This would require analyzing audio files and rendering the waveform as a visual guide.

**Collaborative editing.** With everything running client-side, real-time collaboration would require a sync layer - perhaps WebRTC for peer-to-peer editing sessions, or a lightweight server for project sharing.

**Performance optimization.** Implementing video proxy workflows (edit with lower-res previews, export with full quality) would improve responsiveness. Web Workers could offload heavy processing from the main thread.

## Try It Yourself

Whether you're curious about browser-based media processing, looking to understand FFmpeg filter chains, or just want a simple tool for quick edits, give SSVE a spin. Head over to [ssve.org](https://ssve.org/) to try it live, or check out the [GitHub repository](https://github.com/FumingPower3925/ssve.org) to see how it's built.

The codebase is organized for learning - clear separation between UI components, state management, and FFmpeg processing logic. The export system in particular (`lib/exportVideo.ts`) is worth studying if you're working with FFmpeg.wasm.

Building this taught me that the web platform is capable of far more than I initially imagined. With WebAssembly, modern browser APIs, and thoughtful architecture, you can create surprisingly powerful tools that run entirely client-side. No servers, no uploads, no installation - just open a tab and start creating.