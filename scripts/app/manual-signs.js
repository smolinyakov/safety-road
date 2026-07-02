/* Пользовательские дорожные знаки и их сериализация в ссылку маршрута. */
// Конфигурация доступных типов знаков.
const manualSignTypes = {
  "parent-safe": {
    symbol: "✓",
    title: "Безопасный участок",
  },
  "parent-attention": {
    symbol: "!",
    title: "Нужно внимание",
  },
  "parent-danger": {
    symbol: "!",
    title: "Опасный участок",
  },
  "parent-meeting": {
    symbol: "★",
    title: "Место встречи с ребёнком",
  },
};

// Popup оставляем компактным: фотографий у пользовательских знаков пока нет.
function makeManualSignPopup(sign) {
  const title = manualSignTypes[sign.type]?.title ?? "Дорожный знак";

  return `
    <div class="safety-popup">
      <strong>${title}</strong>
      <button class="manual-sign-remove" type="button" data-manual-sign-id="${sign.id}">Удалить отметку</button>
    </div>
  `;
}

// Пересоздаёт маркеры после восстановления состояния или изменения набора знаков.
function renderManualSigns() {
  manualSigns.forEach((sign) => {
    if (sign.marker) {
      map.removeLayer(sign.marker);
      sign.marker = null;
    }

    const typeInfo = manualSignTypes[sign.type] ?? manualSignTypes["parent-safe"];
    const marker = L.marker([sign.lat, sign.lng], {
      icon: createSafetyIcon(typeInfo.symbol, sign.type),
      zIndexOffset:
        sign.type === "parent-danger" ? 1200 : 900,
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

// Сообщает share-модулю, что ссылку и QR нужно собрать заново.
function notifyManualSignsChanged() {
  window.dispatchEvent(new Event("manual-signs-change"));
}

// Сохраняет новый знак и синхронизирует слой карты.
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
  notifyManualSignsChanged();
}

// Удаляет последний знак для Ctrl/Cmd+Z.
function undoLastManualSign() {
  const lastSign = manualSigns[manualSigns.length - 1];

  if (lastSign) {
    removeManualSign(lastSign.id);
  }
}

// Удаляет знак из состояния и со слоя Leaflet.
function removeManualSign(id) {
  const sign = manualSigns.find((item) => item.id === id);

  if (sign?.marker) {
    map.removeLayer(sign.marker);
  }

  manualSigns = manualSigns.filter((item) => item.id !== id);
  notifyManualSignsChanged();
}

// Очищает слой и при необходимости завершает режим постановки.
function clearManualSigns(shouldExitMode = true) {
  manualSigns.forEach((sign) => {
    if (sign.marker) {
      map.removeLayer(sign.marker);
    }
  });
  manualSigns = [];
  notifyManualSignsChanged();

  if (shouldExitMode) {
    setManualSignMode(false);
  }
}

// Переключает режим постановки знака кликом по карте.
function setManualSignMode(isActive) {
  isAddingManualSign = isActive;
  signPicker.hidden = !isActive;
  addSignToggle.classList.toggle("is-active", isActive);
  addSignToggle.textContent = isActive ? "Скрыть" : "Добавить отметку";
  mapArea?.classList.toggle("is-placing-sign", isActive);
}

// Кодирует знаки в компактный параметр ссылки.
function serializeManualSigns() {
  return manualSigns
    .map((sign) => `${sign.type}:${sign.lat.toFixed(6)},${sign.lng.toFixed(6)}`)
    .join(";");
}

// Восстанавливает знаки из параметра ссылки, пропуская повреждённые записи.
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
  notifyManualSignsChanged();
}
