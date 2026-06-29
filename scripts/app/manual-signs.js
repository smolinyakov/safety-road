/* Ручные дорожные знаки: добавление, удаление, очистка и сохранение в ссылке. */
// Типы знаков, которые пользователь может поставить вручную на карту.
const manualSignTypes = {
  crossing: {
    symbol: "🚶",
    title: "Пешеходный переход",
  },
  light: {
    symbol: "🚦",
    title: "Светофор",
  },
  speed: {
    symbol: "40",
    title: "Ограничение скорости: 40 км/ч",
  },
  danger: {
    symbol: "!",
    title: "Опасный участок дороги",
  },
};

// Создаёт содержимое popup для ручного знака с кнопкой удаления.
function makeManualSignPopup(sign) {
  const title = manualSignTypes[sign.type]?.title ?? "Дорожный знак";

  return `
    <div class="safety-popup">
      <strong>${title}</strong>
      <div class="safety-photo-placeholder" aria-label="Заглушка фотографии участка">
        <span aria-hidden="true">📷</span>
        <small>Фото участка</small>
      </div>
      <button class="manual-sign-remove" type="button" data-manual-sign-id="${sign.id}">Удалить знак</button>
    </div>
  `;
}

// Перерисовывает ручные знаки: они не зависят от выбранного маршрута и не удаляются при смене варианта.
function renderManualSigns() {
  manualSigns.forEach((sign) => {
    if (sign.marker) {
      map.removeLayer(sign.marker);
      sign.marker = null;
    }

    const typeInfo = manualSignTypes[sign.type] ?? manualSignTypes.crossing;
    const marker = L.marker([sign.lat, sign.lng], {
      icon: createSafetyIcon(typeInfo.symbol, sign.type),
      zIndexOffset:
        sign.type === "light" || sign.type === "danger" ? 1200 : 900,
    });
    syncSafetyMarkerVisibility(marker, sign.type);

    marker.bindPopup(makeManualSignPopup(sign));
    marker.on("popupopen", () => {
      const button = document.querySelector(
        `[data-manual-sign-id="${sign.id}"]`,
      );
      if (button) {
        button.addEventListener("click", () => removeManualSign(sign.id));
      }
    });

    sign.marker = marker;
  });
}

// Добавляет пользовательский знак в выбранной точке карты.
function addManualSign(latlng, type = selectedManualSignType) {
  manualSigns.push({
    id: window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    type,
    lat: Number(latlng.lat.toFixed(6)),
    lng: Number(latlng.lng.toFixed(6)),
    marker: null,
  });
  renderManualSigns();
}

// Удаляет последний поставленный пользователем знак. Используется для Ctrl+Z.
function undoLastManualSign() {
  const lastSign = manualSigns[manualSigns.length - 1];

  if (lastSign) {
    removeManualSign(lastSign.id);
  }
}

// Удаляет конкретный пользовательский знак.
function removeManualSign(id) {
  const sign = manualSigns.find((item) => item.id === id);

  if (sign?.marker) {
    map.removeLayer(sign.marker);
  }

  manualSigns = manualSigns.filter((item) => item.id !== id);
}

// Полностью очищает пользовательские знаки. Обычно также выключает режим постановки.
function clearManualSigns(shouldExitMode = true) {
  manualSigns.forEach((sign) => {
    if (sign.marker) {
      map.removeLayer(sign.marker);
    }
  });
  manualSigns = [];

  if (shouldExitMode) {
    setManualSignMode(false);
  }
}

// Показывает панель ручных знаков только когда маршрут уже построен.
function updateManualSignsPanelVisibility() {
  if (!manualSignsPanel) return;

  const hasRoute = routeVariants.length > 0;

  manualSignsPanel.hidden = !hasRoute;

  if (!hasRoute) {
    setManualSignMode(false);
  }
}

// Включает или выключает режим постановки знака кликом по карте.
function setManualSignMode(isActive) {
  isAddingManualSign = isActive;
  signPicker.hidden = !isActive;
  addSignToggle.classList.toggle("is-active", isActive);
  addSignToggle.textContent = isActive ? "Скрыть" : "Добавить знак";
  mapArea?.classList.toggle("is-placing-sign", isActive);
}

// Кодирует ручные знаки компактно для ссылки/QR-кода.
function serializeManualSigns() {
  return manualSigns
    .map((sign) => `${sign.type}:${sign.lat.toFixed(6)},${sign.lng.toFixed(6)}`)
    .join(";");
}

// Восстанавливает ручные знаки из ссылки.
function restoreManualSignsFromUrl() {
  const rawSigns = new URLSearchParams(window.location.search).get("signs");

  if (!rawSigns) {
    return;
  }

  manualSigns.forEach((sign) => {
    if (sign.marker) map.removeLayer(sign.marker);
  });
  manualSigns = rawSigns
    .split(";")
    .map((item) => {
      const [type, coordinates] = item.split(":");
      const [lat, lng] = (coordinates ?? "").split(",").map(Number);

      if (
        !manualSignTypes[type] ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return null;
      }

      return {
        id: window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
        type,
        lat,
        lng,
        marker: null,
      };
    })
    .filter(Boolean);

  renderManualSigns();
}
