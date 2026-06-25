/* Окно «Поделиться маршрутом»: QR-код и копирование ссылки. */
(function () {
  const modal = document.getElementById("shareRouteModal");
  const qr = document.getElementById("routeQrCode");
  const link = document.getElementById("shareRouteLink");
  const copy = document.getElementById("copyRouteLink");
  const closeButtons = document.querySelectorAll("[data-close-share-modal]");

  if (!modal || !qr || !link || !copy) return;

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

    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    modal.hidden = true;
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


