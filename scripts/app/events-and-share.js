/* События интерфейса, мобильная панель и восстановление маршрута из ссылки. */
// Submit покрывает кнопку поиска и Enter в поле адреса.
addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(addressSearchTimer);
  const query = addressInput.value.trim();

  if (!query) {
    clearStartPoint();
    return;
  }

  openMobileSheetForAddressSearch();
  void searchAddressSuggestions(query);
});
// Debounce сокращает число запросов Nominatim при быстром вводе.
addressInput.addEventListener("input", () => {
  clearTimeout(addressSearchTimer);
  clearAddressSuggestions();
  updateAddressClearVisibility();

  const query = addressInput.value.trim();

  if (query.length < 1) {
    clearStartPoint();
    return;
  }

  openMobileSheetForAddressSearch();
  addressSearchTimer = setTimeout(() => {
    void searchAddressSuggestions(query);
  }, 300);
});

addressInput.addEventListener("focus", () => {
  if (!startMarker && addressInput.value.trim()) {
    openMobileSheetForAddressSearch();
  }
});
// Переключение списка школ из верхней карточки.
schoolPickerButton.addEventListener("click", () => {
  setSchoolPickerOpen(schoolPickerPanel.hidden);
});

// Список школ фильтруется локально.
schoolSearchInput.addEventListener("input", () => {
  renderSchoolList(schoolSearchInput.value);
});

// Закрываем список школы по клику вне компонента.
document.addEventListener("click", (event) => {
  const isClickInsidePicker =
    schoolPickerButton.contains(event.target) ||
    schoolPickerPanel.contains(event.target);

  if (!isClickInsidePicker) {
    setSchoolPickerOpen(false);
  }
});

// Ctrl/Cmd+Z отменяет последний знак; Escape закрывает список школ.
document.addEventListener(
  "keydown",
  (event) => {
    const isUndoShortcut =
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      (event.code === "KeyZ" || event.key.toLowerCase() === "z");
    const isTextInput =
      event.target instanceof HTMLElement &&
      Boolean(
        event.target.closest('input, textarea, [contenteditable="true"]'),
      );

    if (isUndoShortcut && !isTextInput && manualSigns.length) {
      event.preventDefault();
      event.stopPropagation();
      undoLastManualSign();
      return;
    }

    if (event.key === "Escape") {
      setSchoolPickerOpen(false);
    }
  },
  true,
);

const mobileSheetQuery = window.matchMedia("(max-width: 760px)");
const mobileSheetSnapDuration = 320;
const mobileSheetDrag = {
  pointerId: null,
  startY: 0,
  startHeight: 0,
  currentHeight: 0,
  moved: false,
  suppressClick: false,
  heights: null,
  snapTimer: null,
};

function getMobileSheetState() {
  if (sidebar.classList.contains("is-mobile-hidden")) return "hidden";
  if (sidebar.classList.contains("is-mobile-expanded")) return "expanded";
  return "collapsed";
}

function setMobileAddressSearchActive(isActive) {
  if (!sidebar) return;
  sidebar.classList.toggle("is-mobile-address-searching", Boolean(isActive));
}

function openMobileSheetForAddressSearch() {
  if (!mobileSheetQuery.matches) return;

  setMobileAddressSearchActive(true);
  setMobileSheetState("expanded");
}

window.setMobileAddressSearchActive = setMobileAddressSearchActive;

function updateMobileSheetAttachedControls(height) {
  if (!mobileSheetQuery.matches || !Number.isFinite(height)) return;

  sidebar.style.setProperty("--mobile-sheet-current-height", `${height}px`);
}

// Плавающие QR/share-кнопки всегда опираются на фактическую высоту панели.
if ("ResizeObserver" in window) {
  const mobileSheetResizeObserver = new ResizeObserver(() => {
    if (
      !mobileSheetQuery.matches ||
      sidebar.classList.contains("is-mobile-dragging")
    ) {
      return;
    }

    updateMobileSheetAttachedControls(sidebar.getBoundingClientRect().height);
  });

  mobileSheetResizeObserver.observe(sidebar);
}

function applyMobileSheetState(state) {
  sidebar.classList.toggle("is-mobile-hidden", state === "hidden");
  sidebar.classList.toggle("is-mobile-expanded", state === "expanded");
  mobileSheetToggle.setAttribute(
    "aria-expanded",
    String(state === "expanded"),
  );
  mobileSheetToggle.lastChild.textContent =
    state === "hidden"
      ? "Открыть панель"
      : "Введите название улицы или места";

  return state;
}

function finishMobileSheetSnap(targetHeight) {
  window.clearTimeout(mobileSheetDrag.snapTimer);
  mobileSheetDrag.snapTimer = window.setTimeout(() => {
    sidebar.classList.remove("is-mobile-snapping");
    sidebar.style.removeProperty("height");
    updateMobileSheetAttachedControls(targetHeight);
    map.invalidateSize();
  }, mobileSheetSnapDuration + 40);
}

function setMobileSheetState(state, options = {}) {
  if (!sidebar || !mobileSheetToggle) return;

  if (!mobileSheetQuery.matches) {
    sidebar.style.removeProperty("height");
    applyMobileSheetState(state);
    setTimeout(() => map.invalidateSize(), 220);
    return;
  }

  const shouldAnimate = options.animate !== false;
  const startHeight = Number.isFinite(options.fromHeight)
    ? options.fromHeight
    : sidebar.getBoundingClientRect().height;
  const targetHeight = measureMobileSheetHeight(state);

  window.clearTimeout(mobileSheetDrag.snapTimer);
  sidebar.classList.remove("is-mobile-dragging");
  sidebar.style.height = `${startHeight}px`;
  updateMobileSheetAttachedControls(startHeight);
  applyMobileSheetState(state);

  if (!shouldAnimate || Math.abs(startHeight - targetHeight) < 1) {
    sidebar.classList.remove("is-mobile-snapping");
    sidebar.style.removeProperty("height");
    updateMobileSheetAttachedControls(targetHeight);
    setTimeout(() => map.invalidateSize(), 220);
    return;
  }

  sidebar.classList.add("is-mobile-snapping");
  sidebar.getBoundingClientRect();

  requestAnimationFrame(() => {
    sidebar.style.height = `${targetHeight}px`;
    updateMobileSheetAttachedControls(targetHeight);
    finishMobileSheetSnap(targetHeight);
  });
}

function measureMobileSheetHeight(state) {
  const previousState = getMobileSheetState();
  const previousHeight = sidebar.style.height;
  const previousTransition = sidebar.style.transition;

  sidebar.style.transition = "none";
  sidebar.style.removeProperty("height");
  sidebar.classList.toggle("is-mobile-hidden", state === "hidden");
  sidebar.classList.toggle("is-mobile-expanded", state === "expanded");

  const height = sidebar.getBoundingClientRect().height;

  sidebar.classList.toggle("is-mobile-hidden", previousState === "hidden");
  sidebar.classList.toggle("is-mobile-expanded", previousState === "expanded");
  sidebar.style.height = previousHeight;
  sidebar.style.transition = previousTransition;

  return height;
}

function getMobileSheetHeights() {
  return {
    hidden: measureMobileSheetHeight("hidden"),
    collapsed: measureMobileSheetHeight("collapsed"),
    expanded: measureMobileSheetHeight("expanded"),
  };
}

function clampMobileSheetHeight(height, heights) {
  return Math.min(Math.max(height, heights.hidden), heights.expanded);
}

mobileSheetToggle?.addEventListener("click", () => {
  if (mobileSheetDrag.suppressClick) {
    mobileSheetDrag.suppressClick = false;
    return;
  }

  if (getMobileSheetState() === "hidden") {
    setMobileSheetState("collapsed");
    return;
  }

  setMobileSheetState(
    getMobileSheetState() === "expanded" ? "collapsed" : "expanded",
  );
});

mobileSheetToggle?.addEventListener("pointerdown", (event) => {
  if (!mobileSheetQuery.matches || !event.isPrimary) return;

  window.clearTimeout(mobileSheetDrag.snapTimer);
  sidebar.classList.remove("is-mobile-snapping");

  mobileSheetDrag.pointerId = event.pointerId;
  mobileSheetDrag.startY = event.clientY;
  mobileSheetDrag.startHeight = sidebar.getBoundingClientRect().height;
  mobileSheetDrag.currentHeight = mobileSheetDrag.startHeight;
  mobileSheetDrag.moved = false;
  mobileSheetDrag.suppressClick = false;
  mobileSheetDrag.heights = getMobileSheetHeights();

  sidebar.style.height = `${mobileSheetDrag.startHeight}px`;
  updateMobileSheetAttachedControls(mobileSheetDrag.startHeight);
  sidebar.classList.add("is-mobile-dragging");
  mobileSheetToggle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

mobileSheetToggle?.addEventListener("pointermove", (event) => {
  if (mobileSheetDrag.pointerId !== event.pointerId) return;

  const deltaY = event.clientY - mobileSheetDrag.startY;
  if (Math.abs(deltaY) > 4) {
    mobileSheetDrag.moved = true;
  }

  const heights = mobileSheetDrag.heights || getMobileSheetHeights();
  const nextHeight = clampMobileSheetHeight(
    mobileSheetDrag.startHeight - deltaY,
    heights,
  );

  sidebar.classList.remove("is-mobile-hidden");
  sidebar.classList.toggle(
    "is-mobile-expanded",
    nextHeight > heights.collapsed + 24,
  );
  sidebar.style.height = `${nextHeight}px`;
  updateMobileSheetAttachedControls(nextHeight);
  mobileSheetDrag.currentHeight = nextHeight;
  event.preventDefault();
});

mobileSheetToggle?.addEventListener("pointerup", (event) => {
  if (mobileSheetDrag.pointerId !== event.pointerId) return;

  const heights = mobileSheetDrag.heights || getMobileSheetHeights();
  const height = mobileSheetDrag.currentHeight || mobileSheetDrag.startHeight;
  const hiddenLimit = (heights.hidden + heights.collapsed) / 2;
  const expandedLimit = heights.collapsed + (heights.expanded - heights.collapsed) * 0.45;
  let targetState = "collapsed";

  if (height <= hiddenLimit) {
    targetState = "hidden";
  } else if (height >= expandedLimit) {
    targetState = "expanded";
  }

  if (mobileSheetToggle.hasPointerCapture(event.pointerId)) {
    mobileSheetToggle.releasePointerCapture(event.pointerId);
  }
  setMobileSheetState(targetState, { fromHeight: height });

  mobileSheetDrag.suppressClick = mobileSheetDrag.moved;
  mobileSheetDrag.pointerId = null;
  mobileSheetDrag.heights = null;
});

mobileSheetToggle?.addEventListener("pointercancel", (event) => {
  if (mobileSheetDrag.pointerId !== event.pointerId) return;

  const height = mobileSheetDrag.currentHeight || mobileSheetDrag.startHeight;

  if (mobileSheetToggle.hasPointerCapture(event.pointerId)) {
    mobileSheetToggle.releasePointerCapture(event.pointerId);
  }
  setMobileSheetState(getMobileSheetState(), { fromHeight: height });
  mobileSheetDrag.pointerId = null;
  mobileSheetDrag.heights = null;
});
// Не передаём Leaflet жесты, начавшиеся внутри мобильной панели.
["click", "pointerdown", "pointermove", "touchstart", "touchmove", "wheel"].forEach(
  (eventName) => {
    sidebar.addEventListener(
      eventName,
      (event) => {
        event.stopPropagation();
      },
      { passive: true },
    );
  },
);

addSignToggle.addEventListener("click", () => {
  setManualSignMode(!isAddingManualSign);
});

cancelSignModeButton.addEventListener("click", () => {
  setManualSignMode(false);
});

clearManualSignsButton.addEventListener("click", () => {
  clearManualSigns(false);
});

signOptionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedManualSignType = button.dataset.signType;
    signOptionButtons.forEach((item) =>
      item.classList.toggle("is-selected", item === button),
    );
  });
});
initializeSchoolPicker();
// Клик по карте ставит знак в активном режиме или выбирает стартовую точку.
map.on("click", (event) => {
  if (isAddingManualSign) {
    addManualSign(event.latlng);
    return;
  }

  void updateAddressInputFromPoint(event.latlng);
  buildRoute(event.latlng);
});

// Сбрасывает стартовую точку и всё состояние, зависящее от маршрута.
function clearStartPoint() {
  if (activeRouteRequest) {
    activeRouteRequest.abort();
    activeRouteRequest = null;
  }

  if (activeAddressRequest) {
    activeAddressRequest.abort();
    activeAddressRequest = null;
  }

  if (activeReverseAddressRequest) {
    activeReverseAddressRequest.abort();
    activeReverseAddressRequest = null;
  }

  if (startMarker) {
    map.removeLayer(startMarker);
    startMarker = null;
  }

  addressInput.value = "";
  setMobileAddressSearchActive(false);
  clearAddressSuggestions();
  clearRouteLayers();
  clearSafetyMarkers();
  clearManualSigns();
  routeVariants = [];
  selectedRouteIndex = 0;
  routeReasonsElement.replaceChildren();
  routeReasonsElement.hidden = true;
  optionsSection.hidden = true;
  updateAddressClearVisibility();
  document.body.classList.remove("has-start-point");
  setMobileSheetState("collapsed");
  setProgress("idle");
  setStatus("Введите адрес или нажмите на любое место карты.");
}

addressClearButton?.addEventListener("click", () => {
  clearStartPoint();
  addressInput.focus({ preventScroll: true });
});

// Формирует ссылку со стартовой точкой, вариантом маршрута и ручными знаками.
window.getShareRouteUrl = function getShareRouteUrl() {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.delete("start");
  shareUrl.searchParams.delete("variant");
  shareUrl.searchParams.delete("signs");

  if (startMarker) {
    const point = startMarker.getLatLng();
    shareUrl.searchParams.set(
      "start",
      `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`,
    );
  }

  if (routeVariants.length) {
    shareUrl.searchParams.set("variant", String(selectedRouteIndex + 1));
  }

  if (manualSigns.length) {
    shareUrl.searchParams.set("signs", serializeManualSigns());
  }

  return shareUrl.toString();
};

// Восстанавливает маршрут и знаки из query-параметров.
async function restoreSharedRouteFromUrl() {
  const urlParameters = new URLSearchParams(window.location.search);
  const savedStart = urlParameters.get("start");
  const savedVariant = Number(urlParameters.get("variant")) - 1;
  shouldRestoreManualSignsFromUrl = urlParameters.has("signs");

  if (!savedStart) {
    shouldRestoreManualSignsFromUrl = false;
    return;
  }

  const [latitude, longitude] = savedStart.split(",").map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    shouldRestoreManualSignsFromUrl = false;
    return;
  }

  await buildRoute(L.latLng(latitude, longitude));
  if (shouldRestoreManualSignsFromUrl && routeVariants.length) {
    restoreManualSignsFromUrl();
  }
  shouldRestoreManualSignsFromUrl = false;
  if (Number.isInteger(savedVariant) && routeVariants[savedVariant]) {
    showSelectedRoute(savedVariant);
  }
}

function disableAddressInputCache() {
  addressInput.setAttribute("autocomplete", "off");
  addressInput.setAttribute("autocapitalize", "off");
  addressInput.setAttribute("autocorrect", "off");
  addressInput.setAttribute("spellcheck", "false");

  if (!new URLSearchParams(window.location.search).has("start")) {
    addressInput.value = "";
    clearAddressSuggestions();
    updateAddressClearVisibility();
  }
}

window.addEventListener("pageshow", disableAddressInputCache);

window.addEventListener("load", () => {
  disableAddressInputCache();
  void restoreSharedRouteFromUrl();
});
