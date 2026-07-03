/** Minimal <dialog>-based image lightbox for article figures. */

const dialog = document.createElement("dialog");
dialog.className = "lightbox";
dialog.innerHTML = `<button type="button" class="lightbox-close" aria-label="Close">×</button><img alt="">`;
document.body.appendChild(dialog);

const img = dialog.querySelector("img")!;

document.addEventListener("click", (event) => {
  const target = (event.target as Element).closest?.("[data-lightbox]") as HTMLImageElement | null;
  if (!target) return;
  img.src = target.currentSrc || target.src;
  img.alt = target.alt;
  dialog.showModal();
});

dialog.addEventListener("click", (event) => {
  // Close on backdrop or the × button; clicks on the image itself keep it open.
  if (event.target === dialog || (event.target as Element).closest(".lightbox-close")) {
    dialog.close();
  }
});
