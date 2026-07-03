/** Table-of-contents scroll-spy: highlights the section currently in view. */

const toc = document.querySelector(".toc-desktop");
if (toc) {
  const links = new Map(
    [...toc.querySelectorAll<HTMLAnchorElement>("a[href^='#']")].map((a) => [
      a.getAttribute("href")!.slice(1),
      a,
    ]),
  );
  const headings = [...links.keys()]
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);

  let activeId: string | null = null;

  function setActive(id: string | null): void {
    if (id === activeId) return;
    if (activeId) links.get(activeId)?.removeAttribute("aria-current");
    if (id) links.get(id)?.setAttribute("aria-current", "true");
    activeId = id;
  }

  const visible = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      // Highlight the first visible heading; if none, the last one scrolled past.
      if (visible.size) {
        for (const h of headings) {
          if (visible.has(h.id)) {
            setActive(h.id);
            break;
          }
        }
      } else {
        let last: string | null = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top < 80) last = h.id;
        }
        setActive(last);
      }
    },
    { rootMargin: "-64px 0px -70% 0px" },
  );
  for (const h of headings) observer.observe(h);
}
