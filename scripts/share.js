/* Окно «Поделиться маршрутом»: QR-код и копирование ссылки. */
(function () {
  const modal = document.getElementById("shareRouteModal");
  const dialog = modal?.querySelector(".route-share-dialog");
  const qr = document.getElementById("routeQrCode");
  const link = document.getElementById("shareRouteLink");
  const copy = document.getElementById("copyRouteLink");
  const closeButtons = document.querySelectorAll("[data-close-share-modal]");

  if (!modal || !dialog || !qr || !link || !copy) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "share-route-button";
  button.hidden = true;
  button.innerHTML = '<span aria-hidden="true">↗</span> Поделиться маршрутом';

  // Кнопка выводится рядом с уже существующей кнопкой удаления стартовой точки.
  const clearButton = document.getElementById("clear-start");
  const routesSection = document.getElementById("route-options-section");
  if (clearButton) clearButton.insertAdjacentElement("beforebegin", button);

  // Появляется только после успешного построения хотя бы одного варианта пути.
  function updateShareButtonVisibility() {
    button.hidden = !routesSection || routesSection.hidden;
  }

  updateShareButtonVisibility();
  if (routesSection) {
    new MutationObserver(updateShareButtonVisibility).observe(routesSection, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  let dragStart = null;
  let dialogShift = { x: 0, y: 0 };

  function applyDialogPosition() {
    dialog.style.transform = `translate(${dialogShift.x}px, ${dialogShift.y}px)`;
  }

  function resetDialogPosition() {
    dragStart = null;
    dialogShift = { x: 0, y: 0 };
    dialog.classList.remove("is-dragging");
    applyDialogPosition();
  }

  function isInteractiveModalElement(element) {
    return Boolean(element.closest("button, a, input, textarea, select, canvas, img"));
  }

  function clampDialogShift(nextX, nextY) {
    const safeGap = 34;
    const rect = dialog.getBoundingClientRect();
    const baseLeft = rect.left - dialogShift.x;
    const baseRight = rect.right - dialogShift.x;
    const baseTop = rect.top - dialogShift.y;
    const baseBottom = rect.bottom - dialogShift.y;

    return {
      x: Math.min(
        window.innerWidth - safeGap - baseRight,
        Math.max(safeGap - baseLeft, nextX),
      ),
      y: Math.min(
        window.innerHeight - safeGap - baseBottom,
        Math.max(safeGap - baseTop, nextY),
      ),
    };
  }

  dialog.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isInteractiveModalElement(event.target)) return;

    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      shiftX: dialogShift.x,
      shiftY: dialogShift.y,
    };
    dialog.classList.add("is-dragging");
    dialog.setPointerCapture(event.pointerId);
  });

  dialog.addEventListener("pointermove", (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;

    event.preventDefault();
    const nextPosition = clampDialogShift(
      dragStart.shiftX + event.clientX - dragStart.x,
      dragStart.shiftY + event.clientY - dragStart.y,
    );
    dialogShift = nextPosition;
    applyDialogPosition();
  });

  function stopDialogDrag(event) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;

    dragStart = null;
    dialog.classList.remove("is-dragging");
  }

  dialog.addEventListener("pointerup", stopDialogDrag);
  dialog.addEventListener("pointercancel", stopDialogDrag);

  function openModal() {
    const url =
      typeof window.getShareRouteUrl === "function"
        ? window.getShareRouteUrl()
        : window.location.href;

    link.href = url;
    link.textContent = url;
    link.title = url;
    qr.replaceChildren();

    if (window.QRCode) {
      new window.QRCode(qr, {
        text: url,
        width: 196,
        height: 196,
        colorDark: "#15243a",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } else {
      qr.textContent = "QR-код не загрузился. Используйте ссылку ниже.";
      qr.classList.add("route-qr-code--error");
    }

    resetDialogPosition();
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    modal.hidden = true;
    resetDialogPosition();
    document.body.classList.remove("modal-open");
  }

  button.addEventListener("click", openModal);
  closeButtons.forEach((item) => item.addEventListener("click", closeModal));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.href);
      copy.textContent = "Ссылка скопирована";
      setTimeout(() => {
        copy.textContent = "Скопировать ссылку";
      }, 1800);
    } catch {
      link.focus();
    }
  });
})();

