import { marked } from "marked";
import { html, raw, type RawHtml } from "./html";
import { renderSpine, type SpineTier } from "../roadmap/spine";

/**
 * The AI roadmap page: a dependency-ordered map of AI course material.
 *
 * Everything here renders at build time. Progress counts come from the `status`
 * field in content/data/ai-roadmap.yml, so the page needs no client state, and
 * the search/filter controls ship hidden until the client script reveals them.
 */

export type Status = "todo" | "doing" | "done";

export interface Course {
  slug: string;
  title: string;
  org: string;
  code?: string;
  tags: string[];
  status?: Status;
  rating?: number;
  verdict?: string;
  /** Another course in the same domain this one is a genuine substitute for. */
  alt_of?: string;
  /** A course (any domain) this one continues from as a sequel or real prerequisite. */
  builds_on_course?: string;
}

export interface Domain {
  name: string;
  courses: Course[];
}

export interface Tier extends SpineTier {
  tagline: string;
  domains: Domain[];
}

export interface Roadmap {
  title: string;
  lede: string;
  note: string;
  tiers: Tier[];
}

export const TAGS = ["free", "paid", "coursera", "univ", "cert", "series"] as const;

const STATUS_LABEL: Record<Status, string> = {
  done: "done",
  doing: "in progress",
  todo: "not started",
};

function courses(tier: Tier): Course[] {
  return tier.domains.flatMap((d) => d.courses);
}

function doneCount(list: Course[]): number {
  return list.filter((c) => c.status === "done").length;
}

/** A decorative bar; the count beside it carries the meaning for screen readers. */
function bar(done: number, total: number): RawHtml {
  const pct = total ? Math.round((done / total) * 1000) / 10 : 0;
  return html`<span class="rm-bar" aria-hidden="true"><i style="width:${String(pct)}%"></i></span>`;
}

function tally(done: number, total: number): RawHtml {
  return html`<span class="rm-tally">${String(done)} of ${String(total)} done</span>`;
}

function courseItem(c: Course, showProgress: boolean, allCourses: Course[]): RawHtml {
  const status: Status = c.status ?? "todo";
  // data-* attributes are what the (optional) client filter reads
  const haystack = [c.title, c.org, c.code ?? ""].join(" ").toLowerCase();

  const verdict = c.verdict
    ? html`<details class="rm-verdict">
<summary>Notes</summary>
<div class="rm-verdict__body">${raw(marked.parseInline(c.verdict) as string)}</div>
</details>`
    : null;

  const rating =
    status === "done" && c.rating
      ? html`<span class="rm-rating"><span class="sr-only">Rated </span>${String(c.rating)}<span aria-hidden="true">/5</span></span>`
      : null;

  // With nothing completed yet, "not started" on all 118 entries is noise, not
  // information; it earns its place once there is real variation to show.
  const statusLabel = showProgress
    ? html`<span class="rm-status rm-status--${status}">${STATUS_LABEL[status]}</span>${rating}`
    : null;

  const prereq = c.builds_on_course ? allCourses.find((x) => x.slug === c.builds_on_course) : undefined;
  const buildsOn = prereq
    ? html`<span class="rm-course__builds-on"><span aria-hidden="true">→</span> builds on <a href="#c-${prereq.slug}">${prereq.title}</a></span>`
    : null;

  return html`<li class="rm-course${prereq ? " rm-course--sequel" : ""}" id="c-${c.slug}" data-status="${status}" data-tags="${c.tags.join(",")}" data-find="${haystack}">
<span class="rm-course__marker rm-course__marker--${status}" aria-hidden="true"></span>
<div class="rm-course__body">
<span class="rm-course__title">${c.title}</span>
<span class="rm-course__meta">
<span class="rm-org">${c.org}</span>${c.code ? html`<span class="rm-code">${c.code}</span>` : null}
${c.tags.map((t) => html`<span class="rm-tag rm-tag--${t}">${t}</span>`)}
${statusLabel}
${buildsOn}
</span>
${verdict}
</div>
</li>`;
}

type DomainItem = { kind: "course"; course: Course } | { kind: "alt-group"; members: Course[] };

/**
 * Courses linked by `alt_of` render as one clustered "pick one" group instead
 * of separate list items. `alt_of` may point through more than one hop, so
 * each course resolves to the root of its chain and courses sharing a root
 * are grouped together, in the order the root first appears.
 */
function domainItems(domain: Domain): DomainItem[] {
  const bySlug = new Map(domain.courses.map((c) => [c.slug, c]));
  const rootOf = (slug: string): string => {
    const seen = new Set<string>();
    let cur = slug;
    while (!seen.has(cur)) {
      seen.add(cur);
      const parent = bySlug.get(cur)?.alt_of;
      if (!parent || !bySlug.has(parent)) return cur;
      cur = parent;
    }
    return cur; // cyclic alt_of data — stop rather than loop forever
  };

  const groups = new Map<string, Course[]>();
  for (const c of domain.courses) {
    const root = rootOf(c.slug);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(c);
  }

  const items: DomainItem[] = [];
  const emitted = new Set<string>();
  for (const c of domain.courses) {
    const root = rootOf(c.slug);
    if (emitted.has(root)) continue;
    emitted.add(root);
    const members = groups.get(root)!;
    items.push(members.length > 1 ? { kind: "alt-group", members } : { kind: "course", course: members[0]! });
  }
  return items;
}

function domainItem(item: DomainItem, showProgress: boolean, allCourses: Course[]): RawHtml {
  if (item.kind === "course") return courseItem(item.course, showProgress, allCourses);
  return html`<li class="rm-alt-group">
<p class="rm-alt-group__label">Pick one</p>
<ul class="rm-courses rm-courses--nested">
${item.members.map((c) => courseItem(c, showProgress, allCourses))}
</ul>
</li>`;
}

function tierSection(t: Tier, all: Tier[], allCourses: Course[], showProgress: boolean): RawHtml {
  const list = courses(t);
  const done = doneCount(list);
  const deps = (t.builds_on ?? [])
    .map((id) => all.find((x) => x.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  return html`<section class="rm-tier" id="${t.id}" style="--tier:var(--tier-${String(t.n)})">
<header class="rm-tier__head">
<h2 class="rm-tier__title"><span class="rm-tier__num" aria-hidden="true">${String(t.n)}</span><span class="sr-only">Tier ${String(t.n)}. </span>${t.name}</h2>
<p class="rm-tier__tagline">${t.tagline}</p>
<p class="rm-tier__meta">
${deps.length
    ? html`<span class="rm-builds">Builds on ${deps.join(" and ")}</span>`
    : html`<span class="rm-builds rm-builds--none">No prerequisites</span>`}
${showProgress ? html`${tally(done, list.length)}${bar(done, list.length)}` : null}
</p>
</header>
${t.domains.map(
    (d) => html`<section class="rm-domain">
<h3 class="rm-domain__title">${d.name}</h3>
<ul class="rm-courses">
${domainItems(d).map((item) => domainItem(item, showProgress, allCourses))}
</ul>
</section>`,
  )}
</section>`;
}

export function renderRoadmap(data: Roadmap): RawHtml {
  const all = data.tiers.flatMap(courses);
  const done = doneCount(all);
  // The progress chrome (bars, tallies, per-course status) earns its place once
  // there is real status to show; at all-todo it would just repeat "0%"/"not
  // started" 118 times. It reappears on its own the day a course changes status.
  const showProgress = all.some((c) => (c.status ?? "todo") !== "todo");

  return html`<article class="rm">
<header class="rm-head">
<h1>${data.title}</h1>
<p class="rm-lede">${data.lede}</p>
${showProgress ? html`<p class="rm-overall">${tally(done, all.length)}${bar(done, all.length)}</p>` : null}
</header>

${raw(renderSpine(data.tiers))}

<nav class="rm-jump" aria-label="Tiers">
<ul>
${data.tiers.map(
    (t) => html`<li style="--tier:var(--tier-${String(t.n)})"><a href="#${t.id}"><span class="rm-jump__num" aria-hidden="true">${String(t.n)}</span>${t.short}</a></li>`,
  )}
</ul>
</nav>

<p class="rm-note">${data.note}</p>

<div class="rm-controls" id="rm-controls" hidden>
<div class="rm-controls__row">
<label class="rm-search">
<span class="sr-only">Search courses</span>
<input type="search" id="rm-q" placeholder="Search course, code or institution" autocomplete="off">
</label>
</div>
<div class="rm-controls__row" role="group" aria-label="Filter by kind">
${TAGS.map(
    (t) => html`<button type="button" class="rm-fil" data-f="${t}" aria-pressed="false">${t}</button>`,
  )}
</div>
<p class="rm-controls__count" id="rm-count" role="status"></p>
</div>

${data.tiers.map((t) => tierSection(t, data.tiers, all, showProgress))}
</article>`;
}
