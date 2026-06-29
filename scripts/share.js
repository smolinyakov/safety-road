/* Поделиться маршрутом: системное меню устройства, QR-код и десктопные сервисы. */
(function () {
  const modal = document.getElementById("shareRouteModal");
  const qr = document.getElementById("routeQrCode");
  const link = document.getElementById("shareRouteLink");
  const copyButton = document.getElementById("copyRouteLink");
  const nativeShareButton = document.getElementById("nativeShareRoute");
  const downloadQrButton = document.getElementById("downloadRouteQr");
  const statusElement = document.getElementById("shareRouteStatus");
  const closeButtons = document.querySelectorAll("[data-close-share-modal]");
  const shareTargets = document.querySelectorAll("[data-share-service]");

  if (!modal || !qr || !link || !copyButton) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "share-route-button";
  button.hidden = true;
  button.innerHTML = `
    <span class="share-route-icon" aria-hidden="true">
      <img src="images/share/share.png" alt="" />
    </span>
    <span class="share-route-text">Поделиться маршрутом</span>
  `;

  const mobileQrButton = document.createElement("button");
  mobileQrButton.type = "button";
  mobileQrButton.className = "mobile-route-qr-button";
  mobileQrButton.hidden = true;
  mobileQrButton.setAttribute("aria-label", "Показать QR-код маршрута");
  mobileQrButton.innerHTML = `<img class="mobile-route-qr-icon" src="images/share/qr.png" alt="" />`;

  const shareHost = document.getElementById("share-button-host");
  const routesSection = document.getElementById("route-options-section");
  const mobileShareQuery = window.matchMedia("(max-width: 760px)");
  let qrFile = null;

  shareHost?.append(button, mobileQrButton);

  function updateShareButtonVisibility() {
    const shouldHide = !routesSection || routesSection.hidden;
    button.hidden = shouldHide;
    mobileQrButton.hidden = shouldHide;
  }

  updateShareButtonVisibility();
  if (routesSection) {
    new MutationObserver(updateShareButtonVisibility).observe(routesSection, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  function setShareStatus(message, isError = false) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
  }

  function getCurrentShareUrl() {
    return typeof window.getShareRouteUrl === "function"
      ? window.getShareRouteUrl()
      : window.location.href;
  }

  function updateServiceLinks(url) {
    const title = "Безопасный маршрут в школу";
    const message = "Посмотрите построенный безопасный маршрут в школу:";
    const encodedUrl = encodeURIComponent(url);
    const encodedMessage = encodeURIComponent(message);
    const encodedFullMessage = encodeURIComponent(`${message}\n${url}`);

    shareTargets.forEach((target) => {
      const service = target.dataset.shareService;

      if (service === "telegram") {
        target.href = `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`;
      } else if (service === "max") {
        target.href = `https://max.ru/:share?text=${encodedFullMessage}`;
      } else if (service === "vk") {
        target.href = `https://vk.com/share.php?url=${encodedUrl}&title=${encodeURIComponent(title)}`;
      } else if (service === "email") {
        target.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodedFullMessage}`;
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [metadata, encodedData] = dataUrl.split(",");
    if (!metadata || !encodedData) return null;

    const mimeType = metadata.match(/data:([^;]+)/)?.[1] ?? "image/png";
    const binary = atob(encodedData);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  function createQrFile() {
    const canvas = qr.querySelector("canvas");
    const image = qr.querySelector("img");
    const dataUrl = canvas?.toDataURL("image/png") || image?.src;

    if (!dataUrl?.startsWith("data:") || typeof File !== "function") {
      return null;
    }

    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;

    return new File([blob], "bezopasnyi-marshrut-qr.png", {
      type: "image/png",
    });
  }

  function renderQrCode(url) {
    qr.replaceChildren();
    qr.classList.remove("route-qr-code--error");
    qrFile = null;

    if (!window.QRCode) {
      qr.textContent = "QR-код не загрузился. Используйте ссылку ниже.";
      qr.classList.add("route-qr-code--error");
      return;
    }

    new window.QRCode(qr, {
      text: url,
      width: 196,
      height: 196,
      colorDark: "#15243a",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    qrFile = createQrFile();
  }

  function prepareShareData() {
    const url = getCurrentShareUrl();

    link.href = url;
    link.textContent = url;
    link.title = url;
    copyButton.textContent = "Копировать";
    setShareStatus("");
    updateServiceLinks(url);
    renderQrCode(url);

    return url;
  }

  function openModal({ qrOnly = false } = {}) {
    prepareShareData();

    if (nativeShareButton) {
      nativeShareButton.hidden = typeof navigator.share !== "function";
    }

    modal.classList.toggle(
      "is-mobile-qr-only",
      qrOnly && mobileShareQuery.matches,
    );
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modal.querySelector(".route-share-close")?.focus({ preventScroll: true });
  }

  function closeModal() {
    modal.hidden = true;
    modal.classList.remove("is-mobile-qr-only");
    document.body.classList.remove("modal-open");
    button.focus({ preventScroll: true });
  }

  async function copyRouteLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link.href);
      } else {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = link.href;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        document.execCommand("copy");
        temporaryInput.remove();
      }

      copyButton.textContent = "Скопировано";
      setShareStatus("Ссылка скопирована в буфер обмена.");
      setTimeout(() => {
        copyButton.textContent = "Копировать";
      }, 1800);
    } catch {
      setShareStatus("Не удалось скопировать ссылку.", true);
    }
  }

  async function shareThroughDevice() {
    if (typeof navigator.share !== "function") return false;

    const shareData = {
      title: "Безопасный маршрут в школу",
      text: "Посмотрите построенный безопасный маршрут в школу.",
      url: link.href,
    };

    if (qrFile && navigator.canShare?.({ files: [qrFile] })) {
      shareData.files = [qrFile];
    }

    try {
      await navigator.share(shareData);
      setShareStatus("Маршрут передан в системное меню отправки.");
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;

      setShareStatus("Системная отправка недоступна.", true);
      return false;
    }
  }

  async function handleShareButtonClick() {
    if (mobileShareQuery.matches && typeof navigator.share === "function") {
      prepareShareData();
      const shared = await shareThroughDevice();

      if (shared) return;
    }

    openModal();
  }

  function downloadQrCode() {
    if (!qrFile) {
      setShareStatus("Не удалось подготовить PNG с QR-кодом.", true);
      return;
    }

    const objectUrl = URL.createObjectURL(qrFile);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = qrFile.name;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setShareStatus("QR-код сохранён как PNG.");
  }

  button.addEventListener("click", handleShareButtonClick);
  mobileQrButton.addEventListener("click", () => openModal({ qrOnly: true }));
  closeButtons.forEach((item) => item.addEventListener("click", closeModal));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  copyButton.addEventListener("click", copyRouteLink);
  nativeShareButton?.addEventListener("click", async () => {
    prepareShareData();
    await shareThroughDevice();
  });
  downloadQrButton?.addEventListener("click", downloadQrCode);
})();