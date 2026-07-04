/** Articles page: client-side search + tag filtering over rendered cards. */

interface SearchEntry {
  title: string;
  description: string;
  url: string;
  tags: string[];
  series: string | null;
  content: string;
}

const input = document.getElementById("search-input") as HTMLInputElement | null;
const list = document.getElementById("article-list");
const noResults = document.getElementById("no-results");
const filterButtons = [...document.querySelectorAll<HTMLButtonElement>(".tag--filter")];

function announce(message: string): void {
  const region = document.getElementById("a11y-status");
  if (region) region.textContent = message;
}

if (input && list) {
  let index: SearchEntry[] | null = null;
  const cards = [...list.querySelectorAll<HTMLElement>(".article-card")];
  const activeTags = new Set<string>();

  async function loadIndex(): Promise<SearchEntry[]> {
    if (!index) {
      const res = await fetch("/search-index.json");
      index = (await res.json()) as SearchEntry[];
    }
    return index;
  }

  function score(entry: SearchEntry, query: string): number {
    let total = 0;
    if (entry.title.toLowerCase().includes(query)) total += 3;
    if (entry.tags.some((t) => t.toLowerCase().includes(query))) total += 2;
    if (entry.series?.toLowerCase().includes(query)) total += 2;
    if (entry.description.toLowerCase().includes(query)) total += 1;
    if (entry.content.toLowerCase().includes(query)) total += 1;
    return total;
  }

  async function apply(): Promise<void> {
    const query = input!.value.trim().toLowerCase();
    let visible = 0;

    let matches: Set<string> | null = null;
    if (query) {
      const idx = await loadIndex();
      matches = new Set(idx.filter((e) => score(e, query) > 0).map((e) => e.url));
    }

    for (const card of cards) {
      const url = card.querySelector("a")?.getAttribute("href") ?? "";
      const tags = (card.dataset.tags ?? "").split(",").filter(Boolean);
      const tagOk = !activeTags.size || [...activeTags].every((t) => tags.includes(t));
      const queryOk = !matches || matches.has(url);
      const show = tagOk && queryOk;
      card.hidden = !show;
      if (show) visible++;
    }
    if (noResults) noResults.hidden = visible > 0;
    if (query || activeTags.size) {
      announce(visible === 0 ? "No articles match" : `${visible} of ${cards.length} articles shown`);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      apply();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !(e.target as Element).closest("input, textarea")) {
      e.preventDefault();
      input.focus();
    }
  });

  for (const btn of filterButtons) {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag!;
      if (activeTags.has(tag)) {
        activeTags.delete(tag);
        btn.setAttribute("aria-pressed", "false");
      } else {
        activeTags.add(tag);
        btn.setAttribute("aria-pressed", "true");
      }
      const params = new URLSearchParams(location.search);
      if (activeTags.size) params.set("tag", [...activeTags].join(","));
      else params.delete("tag");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
      apply();
    });
  }

  document.getElementById("clear-filters")?.addEventListener("click", () => {
    input.value = "";
    activeTags.clear();
    for (const btn of filterButtons) btn.setAttribute("aria-pressed", "false");
    history.replaceState(null, "", location.pathname);
    apply();
  });

  // Deep link: ?tag=a,b — activate the filter even for tags with no chip button
  // (only the top-N tags get buttons, but any tag can be deep-linked from a card).
  const initial = new URLSearchParams(location.search).get("tag");
  if (initial) {
    for (const tag of initial.split(",").filter(Boolean)) {
      activeTags.add(tag);
      filterButtons.find((b) => b.dataset.tag === tag)?.setAttribute("aria-pressed", "true");
    }
    apply();
  }
}
