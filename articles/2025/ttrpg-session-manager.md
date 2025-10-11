---
title: "Starfinder 2e Session Manager: Building a Browser-Based GM Companion"
date: "11-10-2025"
description: "Exploring the design and implementation of a web-based campaign management tool that helps Game Masters run smoother TTRPG sessions through organized file management, dynamic audio control, and real-time session tracking."
tags: ["next.js", "file-system-api", "ttrpg", "web-app", "typescript", "game-mastering"]
---

Picture this: you're running a tabletop role-playing game (TTRPG) session — think Dungeons & Dragons, but in space. You've got four players waiting expectantly, combat music needs to switch on at just the right moment, you need to reference that NPC's stat block you wrote last week, and someone just asked about a plot detail from three sessions ago. You're juggling physical notes, PDFs, music apps, and trying to keep everything flowing smoothly. Sound chaotic? That's where the Starfinder 2e Session Manager comes in.

This project tackles a problem familiar to anyone who's run a TTRPG campaign: managing the avalanche of content that makes up a game session. Built as a fully static web application using Next.js and modern browser APIs, it transforms how Game Masters (GMs) organize and access their campaign materials during play. No servers, no databases, no complex setup — just point it at a folder of your campaign files and you're ready to run.

Let's dive into what makes this tool tick and the technical decisions that shaped it.

## The GM's Dilemma: Too Much Content, Too Little Time

For the uninitiated, tabletop role-playing games are collaborative storytelling experiences where one person (the GM or Game Master) describes the world and controls non-player characters, while players make decisions for their characters and roll dice to determine outcomes. Starfinder 2e is one such game, set in a science-fantasy universe where players might explore alien planets, engage in space battles, or uncover ancient mysteries.

Running these games requires extensive preparation. A typical three-hour session might involve:
- A detailed plan document with scene descriptions and plot points
- Visual aids (maps, character portraits, location images)
- Music playlists for different moods (ambient exploration, tense investigation, epic combat)
- NPC (non-player character) stat blocks and personality notes
- Monster statistics for encounters
- Reference documents for rules and lore
- Real-time tracking of combat initiative and session notes

Traditional solutions fall short. Physical binders get unwieldy. Generic file explorers don't understand session structure. Virtual tabletops focus on maps and dice, not content organization. Audio apps require constant switching. The result? GMs spend precious session time hunting for files instead of engaging with players.

The Session Manager solves this by treating a game session as a structured workflow with predictable patterns.

## Architecture: Leveraging Browser Capabilities

The technical foundation rests on a few key decisions that dramatically simplify both development and deployment.

### The File System Access API: No Upload Required

At the heart of the application sits the File System Access API, a relatively new browser capability (Chrome and Edge only, unfortunately) that allows web apps to read and write files directly from the user's file system. This is game-changing for a content-heavy application like this one.

Traditional web apps require users to upload files to a server or load them into memory. For a campaign with dozens of markdown documents, hundreds of megabytes of music, and high-resolution maps, that's impractical. The File System Access API sidesteps this entirely — the app requests permission to access a folder, then reads files on-demand as needed.

Here's the elegant simplicity of the FileSystemManager class:

```typescript
async selectFolder(): Promise<FileSystemDirectoryHandle> {
  this.directoryHandle = await window.showDirectoryPicker({
    mode: 'read',
  });
  return this.directoryHandle;
}

async readTextFile(relativePath: string): Promise<string> {
  const fileHandle = await this.getFileHandle(relativePath);
  const file = await fileHandle.getFile();
  return await file.text();
}
```

The browser handles file access permissions, path resolution, and reading. The app just asks for what it needs, when it needs it. No uploads, no temporary storage, no bandwidth waste.

### Static Export: Deploy Anywhere

Built with Next.js 15 using static export mode, the entire application compiles down to plain HTML, CSS, and JavaScript. No Node.js server required. This means it can be hosted on GitHub Pages, Netlify, Vercel, or even run directly from your local file system.

The static approach works because all the dynamic behavior happens client-side. When you load a configuration or read a markdown file, it's your browser doing the work, not a backend server. The File System Access API makes this possible — the "database" is literally the folder on your hard drive.

### Configuration as JSON: Session Portability

Session configurations — which parts of the campaign you've set up, what files belong to each part, audio playlists, etc. — serialize to clean JSON:

```typescript
interface SessionConfig {
  folderName: string;
  parts: Part[];
  playerCharacters: string[];
}

interface Part {
  id: string;
  name: string;
  planFile: FileReference | null;
  images: FileReference[];
  supportDocs: FileReference[];
  bgmPlaylist: AudioFile[];
  eventPlaylists: EventPlaylist[];
}
```

Export your configuration, share it with another GM, or version control it alongside your campaign files. As long as the folder structure matches, the configuration just works. This separation of structure (configuration) from content (files) keeps everything flexible and portable.

## Setup Mode: Organizing the Campaign

Before running a session, the GM uses Setup Mode to structure their content into "parts" — discrete sections of the game session. A three-hour session might break down into:
- Part 1: Opening Scene (15 minutes)
- Part 2: Investigation & Social Encounters (60 minutes)
- Part 3: Combat Encounter (45 minutes)
- Part 4: Finale & Cliffhanger (30 minutes)

For each part, the GM specifies:

**Plan Document**: The main markdown file with scene descriptions, NPC dialogue, skill check DCs, and GM notes. This is the script the GM follows, filled with details like "If players ask about the mysterious signal, reveal that..." or "DC 20 Perception to notice the hidden door."

**Images**: Visual aids to show players. Maps of the starship they're exploring, portraits of important NPCs, dramatic reveals of alien landscapes.

**Support Documents**: Additional markdown files for quick reference. NPC stat blocks ("Captain Vira: HP 85, AC 23, Laser Pistol +12..."), monster statistics, rules clarifications, location descriptions.

**Background Music**: Audio files that loop during this part. Ambient space sounds for exploration, upbeat tavern music for social scenes, silence for dramatic moments.

**Event Playlists**: Special audio that overrides background music when triggered. Combat playlists with intense battle themes, chase music, dramatic stingers for plot reveals.

The FileBrowser component handles file selection through a custom UI that respects the folder structure. Unlike a native file picker, it filters files by type (only showing .md files when selecting a plan, only .mp3/.wav/.ogg when selecting audio) and maintains navigation breadcrumbs for easy folder traversal.

The configuration exports to JSON, ready to be imported at the start of the actual game session.

## Play Mode: Running the Session

When game time arrives, Play Mode transforms the browser into a mission control center for the GM.

### The Core Interface

A dropdown in the top-left switches between parts. The main viewport displays tabs for the plan document, each image, and each support document. Markdown renders with full GitHub-flavored markdown support — tables, task lists, code blocks all work as expected.

But the real magic happens in the periphery.

### Smart Audio Management

The AudioManager class runs constantly in the background, handling all the complexity of browser audio APIs:

```typescript
async playBGM() {
  this.currentMode = 'bgm';
  this.currentBgmIndex = 0;
  await this.loadAndPlayTrack(this.bgmTracks[this.currentBgmIndex]);
}

async startEvent(playlistId: string) {
  const playlist = this.eventPlaylists.get(playlistId);
  this.currentMode = 'event';
  this.currentEventPlaylist = playlist;
  this.currentEventIndex = 0;
  await this.loadAndPlayTrack(playlist.tracks[0]);
}
```

Background music loops through the configured tracks automatically. When the GM triggers an event (like starting combat), the audio smoothly transitions to the event playlist, then returns to background music when stopped. Track skipping, volume control, and play/pause all work as expected, with Object URLs generated on-demand from the file system.

The audio panel hides at the edge of the screen, expanding on hover — keeping it accessible but not intrusive.

### Part Timer: Pacing the Session

One clever feature: if the plan document contains a duration marker like `## Duración: 15-20 minutos`, the PartTimer component extracts it and tracks elapsed time:

```typescript
const durationRegex = /##\s*Duración:\s*(\d+)(?:-(\d+))?\s*minutos?/i;
const match = planContent.match(durationRegex);
```

A compact timer in the bottom-right shows elapsed time and warns when approaching or exceeding the expected duration. This helps GMs maintain pacing — a common challenge when you're deep in roleplay and lose track of time.

### Initiative Tracker: Combat Management

When swords (or laser guns) are drawn, the InitiativeTracker panel slides in from the right. The GM can:
- Pre-populate player characters from the session config
- Add NPCs and monsters on-the-fly
- Set initiative scores (which automatically sorts the list)
- Track combat order visually

This eliminates the "who goes next?" confusion that plagues many combats. The tracker persists across part changes, so a combat that spans multiple scenes maintains continuity.

### Search: Finding That One Thing

Full-text search powered by lunr.js indexes all markdown content at session start. Press Cmd/Ctrl+K (following modern app conventions) and search across every plan, NPC, monster, and reference doc.

The SearchManager extracts context around matches:

```typescript
private extractContext(content: string, query: string): string {
  const cleanContent = content
    .replace(/#{1,6}\s/g, '') // Remove headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    // ... more cleaning
  
  // Find match location and extract surrounding text
  const start = Math.max(0, matchIndex - contextLength / 2);
  const end = Math.min(cleanContent.length, matchIndex + contextLength / 2);
  return cleanContent.substring(start, end);
}
```

Click a result to jump directly to that document. Perfect for "Wait, what was that NPC's motivation again?" moments mid-session.

### Split View: Reference While Reading

When viewing a support document, the "Split with Plan" button opens a side-by-side view with a draggable divider. This lets GMs reference an NPC's stat block while reading the scene description that introduces them, or check monster abilities while describing combat.

The implementation uses a simple ResizeObserver pattern:

```typescript
const [splitPosition, setSplitPosition] = useState(50);

const handleMouseMove = (e: React.MouseEvent) => {
  if (!isDragging) return;
  const percentage = (e.clientX / containerWidth) * 100;
  setSplitPosition(Math.max(20, Math.min(80, percentage)));
}
```

Each panel scrolls independently, maintaining reading position when switching focus.

### Notes Panel: Session Memory

A collapsible notes panel (also edge-mounted, expanding on hover) provides a quick scratchpad. Notes persist in localStorage, surviving part changes and even browser refreshes. Capture player decisions, improvised NPC names, or plot threads to follow up on.

## Design Lessons: Patterns for Content-Heavy Apps

Building this application surfaced several patterns worth sharing:

### Edge-Mounted Panels with Hover Expansion

The audio controls, initiative tracker, and notes panel all use the same pattern — a small indicator at the screen edge that expands when hovered. This keeps critical tools accessible without cluttering the main viewport:

```typescript
{!isExpanded && (
  <div onMouseEnter={() => setIsExpanded(true)}>
    <div className="rounded-l-full pr-3 pl-4 py-3">
      <Icon className="h-5 w-5" />
    </div>
  </div>
)}

<div 
  style={{ transform: isExpanded ? 'translateX(0)' : 'translateX(100%)' }}
  onMouseLeave={() => setIsExpanded(false)}
>
  {/* Full panel content */}
</div>
```

This works brilliantly for secondary tools — they're always within a quick mouse movement, but they don't compete for attention when not needed.

### Progressive Enhancement with Local-First

The File System Access API isn't supported in Safari or Firefox, which is unfortunate. But for the target audience (GMs who are often tech-savvy and willing to use specific browsers for specific tools), it's an acceptable tradeoff for the massive UX improvement of not uploading files.

A production app might detect browser support and offer a degraded upload-based mode for unsupported browsers. This implementation chose simplicity — Chrome or Edge required, period. The README is clear about this limitation.

### Configuration Separation

Storing configuration as JSON separate from content files creates a clean boundary. The campaign folder structure is sacred — just markdown, images, and audio organized however makes sense. The configuration references files by relative path but doesn't dictate folder structure.

This means GMs can reorganize files, use version control on their campaign content, or share folders with other GMs without worrying about breaking the app. Just re-import the configuration and update file paths if needed.

### Object URLs for Media

Rather than loading all images and audio into memory, the app generates Object URLs on-demand:

```typescript
async getFileURL(relativePath: string): Promise<string> {
  const fileHandle = await this.getFileHandle(relativePath);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}
```

The browser handles caching intelligently, and memory usage stays reasonable even with large media files. When an image or audio file is no longer displayed/playing, its Object URL gets revoked to free memory.

### Markdown as the Universal Format

Every text-based content type uses markdown — plans, NPCs, monsters, FAQs, everything. This consistency means:
- GMs can use their favorite markdown editor during prep
- The MarkdownViewer component (react-markdown + remark-gfm) handles everything
- Search works uniformly across all content
- Syntax is familiar to anyone who's used GitHub, Notion, or Obsidian

Tables work great for stat blocks. Checklists track session goals. Code blocks preserve special formatting. It's flexible enough for any campaign content.

## The Current State and Future

The application is deployed at ttrpgsessionmanager.com and fully functional. The codebase reflects pragmatic choices — some polish deliberately deferred in favor of getting it usable for real sessions.

UI refinements will come from actual play-testing. Do GMs want more keyboard shortcuts? Is the initiative tracker visible enough during combat? Does the timer need a pause button? These questions answer themselves after a few sessions.

No major feature work is planned — the core workflow is solid. Small quality-of-life improvements might include:
- Bulk file selection shortcuts
- Customizable panel positions
- Export/import of initiative tracker state
- Audio fade-in/fade-out on transitions

But the fundamental architecture is stable. It does what it sets out to do: make running TTRPG sessions less about file management and more about storytelling.

## Closing Thoughts

This project exemplifies how modern browser APIs can eliminate entire categories of backend complexity. No server means no hosting costs, no scaling concerns, no security audits. Static deployment means instant global CDN distribution. The File System Access API means no upload flows, no storage quotas, no file size limits.

For content-heavy applications with local-first workflows, this pattern is incredibly powerful. Whether you're building a GM tool, a writing app, a music organizer, or any other tool that works with user files, consider whether you really need a backend at all.

The Starfinder 2e Session Manager proves you can build sophisticated, feature-rich applications purely in the browser — and deliver a better user experience in the process. The code is open source at [this repo](https://github.com/FumingPower3925/starfinder2e-session-manager). If you run TTRPGs and want to spend less time fumbling with files and more time crafting memorable moments, give it a try.

After all, the best technology is the kind that gets out of your way and lets you focus on what matters — in this case, spinning tales of adventure among the stars.