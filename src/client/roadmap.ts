/** AI roadmap search + filter. The controls render `hidden` in markup and are
 *  revealed here, so nothing dead appears on a page with JS disabled. */

const controls = document.getElementById("rm-controls");
if (controls) {
  controls.hidden = false;

  const input = document.getElementById("rm-q") as HTMLInputElement | null;
  const count = document.getElementById("rm-count");
  const filters = [...document.querySelectorAll<HTMLButtonElement>(".rm-fil")];
  const courses = [...document.querySelectorAll<HTMLLIElement>(".rm-course")];
  const domains = [...document.querySelectorAll<HTMLElement>(".rm-domain")];

  let activeTag: string | null = null;
  let query = "";

  function apply(): void {
    let visible = 0;
    for (const c of courses) {
      const tags = (c.dataset.tags ?? "").split(",");
      const okTag = !activeTag || tags.includes(activeTag);
      const okQuery = !query || (c.dataset.find ?? "").includes(query);
      const show = okTag && okQuery;
      c.hidden = !show;
      if (show) visible++;
    }
    for (const d of domains) {
      d.hidden = d.querySelectorAll(".rm-course:not([hidden])").length === 0;
    }
    if (count) {
      count.textContent = activeTag || query ? `${String(visible)} of ${String(courses.length)} shown` : "";
    }
  }

  if (input) {
    input.addEventListener("input", () => {
      query = input.value.trim().toLowerCase();
      apply();
    });
  }

  for (const btn of filters) {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.f ?? null;
      const turningOn = btn.getAttribute("aria-pressed") !== "true";
      for (const b of filters) b.setAttribute("aria-pressed", "false");
      if (turningOn) btn.setAttribute("aria-pressed", "true");
      activeTag = turningOn ? tag : null;
      apply();
    });
  }
}
