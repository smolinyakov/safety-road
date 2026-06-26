/* Инициализация событий интерфейса, клики по карте, очистка маршрута и восстановление QR-ссылки. */
// Поддерживаем поиск как кнопкой, так и клавишей Enter.
addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(addressSearchTimer);
  const query = addressInput.value.trim();

  if (!query) {
    clearStartPoint();
    return;
  }

  void searchAddressSuggestions(query);
});
// Автоподсказки запускаются после короткой паузы, чтобы не делать запрос на каждую букву.
addressInput.addEventListener("input", () => {
  clearTimeout(addressSearchTimer);
  clearAddressSuggestions();
  updateAddressClearVisibility();

  const query = addressInput.value.trim();

  if (query.length < 1) {
    clearStartPoint();
    return;
  }

  addressSearchTimer = setTimeout(() => {
    void searchAddressSuggestions(query);
  }, 300);
});
// Стрелка в карточке школы раскрывает список школ и лицеев.
schoolPickerButton.addEventListener("click", () => {
  setSchoolPickerOpen(schoolPickerPanel.hidden);
});

// Поиск внутри списка фильтрует локальный набор школ без обращения к сети.
schoolSearchInput.addEventListener("input", () => {
  renderSchoolList(schoolSearchInput.value);
});

// Клик вне выпадающего списка закрывает его.
document.addEventListener("click", (event) => {
  const isClickInsidePicker =
    schoolPickerButton.contains(event.target) ||
    schoolPickerPanel.contains(event.target);

  if (!isClickInsidePicker) {
    setSchoolPickerOpen(false);
  }
});

// Горячие клавиши: Ctrl/Cmd+Z удаляет последний ручной знак, Escape закрывает список школ.
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

mobileSheetToggle?.addEventListener("click", () => {
  // Если точка ещё не выбрана, панель уже показывает всё полезное: заголовок и поиск.
  // Не раскрываем её в пустое состояние, чтобы верстка не прыгала и не искривлялась.
  if (!startMarker) {
    sidebar.classList.remove("is-mobile-expanded");
    mobileSheetToggle.setAttribute("aria-expanded", "false");
    return;
  }

  const isExpanded = !sidebar.classList.contains("is-mobile-expanded");

  sidebar.classList.toggle("is-mobile-expanded", isExpanded);
  mobileSheetToggle.setAttribute("aria-expanded", String(isExpanded));
  mobileSheetToggle.lastChild.textContent = "Введите название улицы или места";
  setTimeout(() => map.invalidateSize(), 220);
});
// На телефонах Leaflet слушает жесты на всей карте. Если свайп начинается
// на нижней панели, останавливаем всплытие события, чтобы вместо карты
// прокручивалась сама панель маршрута.
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
// Клик по карте — альтернативный способ выбрать стартовую точку.
map.on("click", (event) => {
  if (isAddingManualSign) {
    addManualSign(event.latlng);
    return;
  }

  void updateAddressInputFromPoint(event.latlng);
  buildRoute(event.latlng);
});

// Полностью очищает пользовательскую точку, адрес в строке поиска и результат маршрута.
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
  clearAddressSuggestions();
  clearRouteLayers();
  clearSafetyMarkers();
  clearManualSigns();
  routeVariants = [];
  selectedRouteIndex = 0;
  routeReasonsElement.hidden = true;
  optionsSection.hidden = true;
  updateManualSignsPanelVisibility();
  updateAddressClearVisibility();
  document.body.classList.remove("has-start-point");
  setProgress("idle");
  setStatus("Введите адрес или нажмите на любое место карты.");
}

addressClearButton?.addEventListener("click", () => {
  clearStartPoint();
  addressInput.focus({ preventScroll: true });
});

// Формирует ссылку для QR-кода: сохраняет стартовую точку и выбранный вариант.
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

// При открытии ссылки из QR-кода повторно строим маршрут от сохранённой точки.
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

window.addEventListener("load", () => {
  void restoreSharedRouteFromUrl();
});






