/** Minimal <dialog>-based image lightbox for article figures. */

const dialog = document.createElement("dialog");
dialog.className = "lightbox";
dialog.innerHTML = `<button type="button" class="lightbox-close" aria-label="Close">×</button><img alt="">`;
document.body.appendChild(dialog);

const img = dialog.querySelector("img")!;

// The trigger is a real <button> wrapping the image, so Enter/Space activate it
// natively and the dialog restores focus to it on close.
document.addEventListener("click", (event) => {
  const trigger = (event.target as Element).closest?.(".lightbox-trigger");
  if (!trigger) return;
  const source = trigger.querySelector("img[data-lightbox]") as HTMLImageElement | null;
  if (!source) return;
  img.src = source.currentSrc || source.src;
  img.alt = source.alt;
  dialog.showModal();
});

dialog.addEventListener("click", (event) => {
  // Close on backdrop or the × button; clicks on the image itself keep it open.
  if (event.target === dialog || (event.target as Element).closest(".lightbox-close")) {
    dialog.close();
  }
});
