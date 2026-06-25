// Школа по умолчанию нужна сразу при старте карты и как запасной вариант,
// если внешний сервис OpenStreetMap временно не ответит.
const defaultSchool = {
  name: "МБОУ СОШ №85",
  address: "ул. Малиновского, 19 · Хабаровск",
  coordinates: [48.3820134, 135.1191731],
};

// Список учреждений берём из локального файла scripts/schools-data.js.
// Если файл не подключился, остаётся запасная школа №85.
let khabarovskSchools = Array.isArray(window.KHABAROVSK_SCHOOLS)
  ? window.KHABAROVSK_SCHOOLS
  : [defaultSchool];

// Текущая школа назначения. По умолчанию выбираем школу №85 из локальной базы.
let selectedSchool = khabarovskSchools.find((item) => /№\s*85|#\s*85|\b85\b/i.test(item.name)) ?? defaultSchool;
let school = selectedSchool.coordinates;
// Внешние сервисы OpenStreetMap: маршрутизация и поиск адресов.
const routingService =
  "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const geocodingService = "https://nominatim.openstreetmap.org/search";
const overpassService = "https://overpass-api.de/api/interpreter";
const maximumReasonableRoutes = 3;

// Создаём карту и задаём начальный вид на район школы.
const map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
}).setView(school, 15.6);

// Оставляем обязательную атрибуцию OSM, но убираем стандартный префикс Leaflet.
L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Значки создаются как HTML/SVG, чтобы они были чёткими на любом масштабе карты.
const schoolIcon = L.divIcon({
  className: "",
  html: `
    <div style="width:44px;height:44px;border-radius:50% 50% 50% 0;background:linear-gradient(145deg,#2f80ed,#1769d2);display:grid;place-items:center;transform:rotate(-45deg);box-shadow:0 5px 14px #123d6b66;border:3px solid #fff">
      <svg style="transform:rotate(45deg)" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <path d="M4 21.5h18" stroke="#dbeaff" stroke-width="2" stroke-linecap="round"/>
        <path d="M6 11.2 13 6l7 5.2v10.3H6V11.2Z" fill="#fff"/>
        <path d="M4.8 11.5 13 5.3l8.2 6.2" fill="none" stroke="#dbeaff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10.2 21.5v-5.4h5.6v5.4" fill="#1769d2" opacity="0.95"/>
        <path d="M8.1 12.6h3.1v2.7H8.1v-2.7Zm6.7 0h3.1v2.7h-3.1v-2.7Z" fill="#8ab4f8"/>
        <path d="M13 5.3V2.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M13.8 3.1h4.2l-1 1.4 1 1.4h-4.2V3.1Z" fill="#fdd663"/>
      </svg>
    </div>
  `,
  iconSize: [44, 44],
  iconAnchor: [22, 44],
});

const startIcon = L.divIcon({
  className: "",
  html: `
    <div style="width:30px;height:30px;border:3px solid #fff;border-radius:50%;background:#d93025;color:#fff;display:grid;place-items:center;box-shadow:0 2px 8px #77333366;font-weight:800">A</div>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// Маркер школы постоянный: его нельзя удалить вместе с точкой пользователя.
const schoolMarker = L.marker(school, { icon: schoolIcon }).addTo(map);

// Ссылки на элементы интерфейса получаем один раз после загрузки страницы.
const statusElement = document.getElementById("route-status");
const optionsSection = document.getElementById("route-options-section");
const optionsElement = document.getElementById("route-options");
const addressForm = document.getElementById("address-form");
const addressInput = document.getElementById("address-input");
const suggestionsElement = document.getElementById("address-suggestions");
const routeProgressElement = document.getElementById("route-progress");
const routeReasonsElement = document.getElementById("route-reasons");
const clearStartButton = document.getElementById("clear-start");
const schoolPickerButton = document.getElementById("school-picker-button");
const schoolPickerPanel = document.getElementById("school-picker-panel");
const schoolSearchInput = document.getElementById("school-search-input");
const schoolListElement = document.getElementById("school-list");
const selectedSchoolNameElement = document.getElementById(
  "selected-school-name",
);
const selectedSchoolAddressElement = document.getElementById(
  "selected-school-address",
);
const manualSignsPanel = document.querySelector(".manual-signs-panel");
const addSignToggle = document.getElementById("add-sign-toggle");
const signPicker = document.getElementById("sign-picker");
const cancelSignModeButton = document.getElementById("cancel-sign-mode");
const clearManualSignsButton = document.getElementById("clear-manual-signs");
const signOptionButtons = document.querySelectorAll("[data-sign-type]");
const mapArea = document.querySelector(".map-area");

// Изменяемое состояние: текущая точка отправления, линии и незавершённые запросы.
let startMarker;
let routeLine;
let routeLayers = [];
let safetyMarkers = [];
let activeSafetyRequest;
const safetyObjectsCache = new Map();
let activeRouteRequest;
let activeAddressRequest;
let routeVariants = [];
let selectedRouteIndex = 0;
let addressSearchTimer;
let currentProgressStage = "idle";
let isAddingManualSign = false;
let selectedManualSignType = "crossing";
let manualSigns = [];
let shouldRestoreManualSignsFromUrl = false;

// Нормализует текстовый OSM-тег: убирает лишние пробелы и пустые значения.
function normalizeOsmText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

// Инициализирует выпадающий список из локальной базы учреждений.
function initializeSchoolPicker() {
  selectedSchool = khabarovskSchools.find((item) =>
    /№\s*85|#\s*85|\b85\b/i.test(item.name),
  ) ?? selectedSchool;
  school = selectedSchool.coordinates;
  schoolMarker.setLatLng(school);
  updateSelectedSchoolCard();
  renderSchoolList(schoolSearchInput.value);
}
// Обновляет текст выбранной школы в верхней карточке.
function updateSelectedSchoolCard() {
  selectedSchoolNameElement.textContent = selectedSchool.name;
  selectedSchoolAddressElement.textContent = selectedSchool.address;
}

// Открывает или закрывает список школ по стрелке в hero-блоке.
function setSchoolPickerOpen(isOpen) {
  schoolPickerPanel.hidden = !isOpen;
  schoolPickerButton.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    schoolSearchInput.focus();
    renderSchoolList(schoolSearchInput.value);
  }
}

// Приводит строку поиска и название школы к единому виду: ё=е, №=#, лишняя пунктуация убирается.
function normalizeSchoolSearchText(value) {
  return normalizeOsmText(value)
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/№/g, "#")
    .replace(/\bсредняя\b|\bобщеобразовательная\b|\bмбоу\b|\bсош\b/g, " школа ")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Достаёт номер школы из запроса или названия: «85», «№85», «школа 85» считаются одним смыслом.
function extractSchoolNumber(value) {
  return normalizeSchoolSearchText(value).match(/#?\s*(\d{1,3})/)?.[1] ?? "";
}

// Расстояние Левенштейна показывает, насколько две строки похожи с учётом опечаток.
function getLevenshteinDistance(first, second) {
  if (first === second) return 0;
  if (!first.length) return second.length;
  if (!second.length) return first.length;

  const previousRow = Array.from(
    { length: second.length + 1 },
    (_, index) => index,
  );
  const currentRow = new Array(second.length + 1);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    currentRow[0] = firstIndex;

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost =
        first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      currentRow[secondIndex] = Math.min(
        currentRow[secondIndex - 1] + 1,
        previousRow[secondIndex] + 1,
        previousRow[secondIndex - 1] + substitutionCost,
      );
    }

    previousRow.splice(0, previousRow.length, ...currentRow);
  }

  return previousRow[second.length];
}

// Оценивает, насколько школа подходит под запрос. Чем меньше score, тем выше школа в списке.
function scoreSchoolSearchResult(item, query) {
  const normalizedQuery = normalizeSchoolSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const searchableText = normalizeSchoolSearchText(
    `${item.name} ${item.address}`,
  );
  const queryNumber = extractSchoolNumber(normalizedQuery);
  const schoolNumber = extractSchoolNumber(item.name);

  if (queryNumber && schoolNumber === queryNumber) {
    return 0;
  }

  if (searchableText.includes(normalizedQuery)) {
    return 1;
  }

  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const textWords = searchableText.split(" ").filter(Boolean);
  const everyWordHasSimilarMatch = queryWords.every((queryWord) =>
    textWords.some((word) => {
      if (word.includes(queryWord) || queryWord.includes(word)) {
        return true;
      }

      const allowedDistance = queryWord.length <= 4 ? 1 : 2;
      return getLevenshteinDistance(queryWord, word) <= allowedDistance;
    }),
  );

  if (everyWordHasSimilarMatch) {
    return 2;
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactText = searchableText.replace(/\s+/g, "");
  const allowedDistance = compactQuery.length <= 5 ? 1 : 2;

  if (
    getLevenshteinDistance(
      compactQuery,
      compactText.slice(0, compactQuery.length),
    ) <= allowedDistance
  ) {
    return 3;
  }

  return Infinity;
}

// Возвращает школы, отсортированные по похожести на запрос, а не только по точному вхождению.
function getMatchingSchools(query) {
  return khabarovskSchools
    .map((item, index) => ({
      item,
      index,
      score: scoreSchoolSearchResult(item, query),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (first, second) =>
        first.score - second.score || first.index - second.index,
    )
    .map(({ item }) => item);
}
// Рисует список школ и лицеев с учётом строки поиска.
function renderSchoolList(query = "", loadingMessage = "") {
  const filteredSchools = getMatchingSchools(query);

  schoolListElement.replaceChildren();

  if (loadingMessage) {
    const loadingItem = document.createElement("div");
    loadingItem.className = "school-option-empty";
    loadingItem.textContent = loadingMessage;
    schoolListElement.appendChild(loadingItem);
    return;
  }

  if (!filteredSchools.length) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "school-option-empty";
    emptyMessage.textContent =
      "Ничего не найдено. Попробуйте номер школы или слово «лицей».";
    schoolListElement.appendChild(emptyMessage);
    return;
  }

  filteredSchools.forEach((item) => {
    const option = document.createElement("button");
    const name = document.createElement("strong");
    const address = document.createElement("span");

    option.type = "button";
    option.className = "school-option";
    option.role = "option";
    option.classList.toggle("is-selected", item === selectedSchool);
    name.textContent = item.name;
    address.textContent = item.address;

    option.append(name, address);
    option.addEventListener("click", () => selectSchool(item));
    schoolListElement.appendChild(option);
  });
}

// Делает выбранную школу новой точкой назначения и переносит карту к ней.
function selectSchool(schoolItem) {
  clearManualSigns();
  selectedSchool = schoolItem;
  school = schoolItem.coordinates;
  schoolMarker.setLatLng(school);
  updateSelectedSchoolCard();
  setSchoolPickerOpen(false);
  map.setView(school, 16);

  // Если стартовая точка уже была выбрана, перестраиваем маршрут к новой школе.
  if (startMarker) {
    buildRoute(startMarker.getLatLng());
  } else {
    setStatus(
      `Выбрана школа: ${selectedSchool.name}. Теперь укажите точку отправления.`,
    );
  }
}
// Показывает пользователю краткое сообщение о текущем состоянии приложения.
function setStatus(message) {
  statusElement.textContent = message;
}

// Управляет этапами построения: активный этап крутится, завершённый получает галочку.
// Если построение сорвалось, последний активный этап получает красный крестик без анимации.
function setProgress(stage) {
  const stages = ["point", "route", "score"];

  if (stage === "idle") {
    currentProgressStage = "idle";
    routeProgressElement.hidden = true;
    routeProgressElement
      .querySelectorAll("[data-progress]")
      .forEach((element) => {
        element.classList.remove("is-active", "is-complete", "is-failed");
      });
    return;
  }

  const activeIndex = stages.indexOf(stage);
  const failedIndex = stages.indexOf(currentProgressStage);

  routeProgressElement.hidden = false;
  routeProgressElement
    .querySelectorAll("[data-progress]")
    .forEach((element, index) => {
      const isFailedStage = stage === "failed" && index === failedIndex;

      element.classList.toggle(
        "is-active",
        index === activeIndex && stage !== "done" && stage !== "failed",
      );
      element.classList.toggle(
        "is-complete",
        stage === "failed" ? index < failedIndex : index < activeIndex || stage === "done",
      );
      element.classList.toggle("is-failed", isFailedStage);
    });

  if (stages.includes(stage)) {
    currentProgressStage = stage;
  }
}

// Не маскируем ошибку сети: выводим текст, который реально вернул код или сервис.
function getRoutingErrorMessage(error) {
  return `Маршрут не построен: ${error.message || String(error)}`;
}
// Формирует понятное объяснение условной оценки выбранного маршрута.
function updateRouteReasons(variant) {
  const shortestDistance = Math.min(
    ...routeVariants.map((item) => item.route.distance),
  );
  const extraDistance = Math.round(variant.route.distance - shortestDistance);
  const reasons = [
    `${variant.intersections} пересечений на маршруте`,
    `${variant.turns} поворотов по пути`,
  ];

  if (extraDistance > 25) {
    reasons.push(`на ${extraDistance} м длиннее кратчайшего варианта`);
  } else {
    reasons.push("один из самых коротких вариантов");
  }

  routeReasonsElement.replaceChildren();
  reasons.forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    routeReasonsElement.appendChild(item);
  });
  routeReasonsElement.hidden = false;
}

// Преобразует метры в компактный вид для карточки маршрута.
function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters)} м`
    : `${(meters / 1000).toFixed(1).replace(".", ",")} км`;
}

// Внешний маршрутизатор возвращает длительность в секундах.
function formatDuration(seconds) {
  return `≈ ${Math.max(1, Math.round(seconds / 60))} мин`;
}

// Собирает URL OSRM-совместимого пешеходного маршрутизатора. В URL координаты идут как «долгота, широта».
function makeRoutingUrl(start, viaPoint = null, alternatives = "false") {
  const coordinates = [[start.lat, start.lng]];

  if (viaPoint) {
    coordinates.push(viaPoint);
  }

  coordinates.push(school);

  const path = coordinates
    .map(([latitude, longitude]) => `${longitude},${latitude}`)
    .join(";");
  const parameters = new URLSearchParams({
    alternatives,
    overview: "full",
    geometries: "geojson",
    steps: "true",
  });

  return `${routingService}/${path}?${parameters}`;
}

// Выполняет запрос маршрута и отменяет его по тайм-ауту или при выборе новой точки.
async function requestRoutes(
  start,
  signal,
  viaPoint = null,
  alternatives = "false",
) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Превышено время ожидания маршрутизатора"));
    }, 10000);
  });

  try {
    const response = await Promise.race([
      fetch(makeRoutingUrl(start, viaPoint, alternatives), { signal }),
      timeout,
    ]);

    if (!response.ok) {
      throw new Error(`Сервис маршрутизации вернул код ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Убирает пути, которые больше чем на 25% длиннее или медленнее лучшего варианта.
function filterReasonableRoutes(routes) {
  const shortestDistance = Math.min(...routes.map((route) => route.distance));
  const fastestDuration = Math.min(...routes.map((route) => route.duration));

  return routes.filter((route) => {
    const isTooLong = route.distance > shortestDistance * 1.25;
    const isTooSlow = route.duration > fastestDuration * 1.25;

    return !isTooLong && !isTooSlow;
  });
}

// Создаёт компактный отпечаток геометрии, чтобы не добавлять один и тот же путь дважды.
function routeSignature(route) {
  const points = route.geometry.coordinates;
  const indexes = [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
    Math.round((points.length - 1) * fraction),
  );

  return indexes
    .map((index) => points[index].map((value) => value.toFixed(4)).join(","))
    .join("|");
}

// Вычисляет расстояние между координатами по поверхности Земли; входной формат — [долгота, широта].
function haversineDistance(first, second) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const latitudeDifference = toRadians(second[1] - first[1]);
  const longitudeDifference = toRadians(second[0] - first[0]);
  const latitudeOne = toRadians(first[1]);
  const latitudeTwo = toRadians(second[1]);
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitudeOne) *
      Math.cos(latitudeTwo) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Не пропускает альтернативы, отличающиеся от основного пути одной бессмысленной петлёй.
function isMeaningfullyDifferent(candidate, existingRoutes) {
  const candidatePoints = candidate.geometry.coordinates;
  const sampleCount = 16;

  return existingRoutes.every((route) => {
    const routePoints = route.geometry.coordinates;
    let differentSamples = 0;

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const fraction = sample / (sampleCount - 1);
      const candidatePoint =
        candidatePoints[Math.round((candidatePoints.length - 1) * fraction)];
      const routePoint =
        routePoints[Math.round((routePoints.length - 1) * fraction)];

      if (haversineDistance(candidatePoint, routePoint) > 35) {
        differentSamples += 1;
      }
    }

    return differentSamples / sampleCount >= 0.35;
  });
}

// Считает повороты и пересечения из шагов, полученных от маршрутизатора.
function countRouteFeatures(route) {
  const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
  const turns = steps.filter((step) => {
    const type = step.maneuver?.type;
    return !["depart", "arrive", "continue"].includes(type);
  }).length;
  const intersections = steps.reduce(
    (total, step) => total + (step.intersections?.length ?? 0),
    0,
  );

  return { turns, intersections };
}

// Назначает учебный статус маршрутам. Это эвристика, а не реальная статистика ДТП.
function assessRoutes(routes) {
  const variants = routes.map((route) => {
    const { turns, intersections } = countRouteFeatures(route);

    return {
      route,
      turns,
      intersections,
      riskValue: route.distance / 1000 + turns * 0.25 + intersections * 0.05,
    };
  });

  variants.sort((first, second) => first.riskValue - second.riskValue);

  return variants.map((variant, index) => {
    const lastIndex = variants.length - 1;
    let level = "Рекомендуемый";
    let badgeClass = "safe";
    let color = "#1e9b68";
    let mutedColor = "#48ad81";

    // Третий естественный вариант отмечаем как менее предпочтительный.
    if (variants.length >= 3 && index === lastIndex) {
      level = "Менее предпочтительный";
      badgeClass = "risk";
      color = "#e25050";
      mutedColor = "#ee7474";
    } else if (index > 0) {
      level = "Есть участки внимания";
      badgeClass = "middle";
      color = "#f9ab00";
      mutedColor = "#ffc43d";
    }

    return { ...variant, level, badgeClass, color, mutedColor };
  });
}

// Переводит GeoJSON-координаты из ответа сервиса в порядок, понятный Leaflet.
function getRouteCoordinates(variant) {
  return variant.route.geometry.coordinates.map(([longitude, latitude]) => [
    latitude,
    longitude,
  ]);
}

// Перед отрисовкой нового выбора удаляем все слои старой линии.
function clearRouteLayers() {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];
}

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
      zIndexOffset: sign.type === "light" || sign.type === "danger" ? 1200 : 900,
    }).addTo(map);

    marker.bindPopup(makeManualSignPopup(sign));
    marker.on("popupopen", () => {
      const button = document.querySelector(`[data-manual-sign-id="${sign.id}"]`);
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
    id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
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

      if (!manualSignTypes[type] || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return {
        id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        type,
        lat,
        lng,
        marker: null,
      };
    })
    .filter(Boolean);

  renderManualSigns();
}
// Удаляет реальные знаки предыдущего маршрута и отменяет незавершённый запрос к Overpass.
function clearSafetyMarkers() {
  if (activeSafetyRequest) {
    activeSafetyRequest.abort();
    activeSafetyRequest = null;
  }

  safetyMarkers.forEach((marker) => map.removeLayer(marker));
  safetyMarkers = [];
}

// Создаёт круглый значок перехода, светофора или участка внимания.
function createSafetyIcon(symbol, type) {
  // SVG подключаем через нативный L.icon: Leaflet корректно масштабирует файл по iconSize.
  if (type === "crossing") {
    return L.icon({
      iconUrl: "images/RU_road_sign_5.19.2.svg",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
    });
  }

  const isTrafficLight = type === "light";

  return L.divIcon({
    className: "",
    html: `<span class="safety-sign safety-sign--${type}">${symbol}</span>`,
    iconSize: isTrafficLight ? [40, 40] : [34, 34],
    iconAnchor: isTrafficLight ? [20, 20] : [17, 17],
  });
}

// Возвращает границы маршрута в порядке, который ожидает Overpass: юг, запад, север, восток.
function getRouteBounds(routePoints, padding = 0.0007) {
  const latitudes = routePoints.map(([, latitude]) => latitude);
  const longitudes = routePoints.map(([longitude]) => longitude);

  return [
    Math.min(...latitudes) - padding,
    Math.min(...longitudes) - padding,
    Math.max(...latitudes) + padding,
    Math.max(...longitudes) + padding,
  ];
}

// Проверяет, что объект OSM расположен рядом с линией маршрута, а не просто в том же районе.
function isObjectNearRoute(objectPoint, routePoints) {
  return routePoints.some(
    (routePoint) => haversineDistance(objectPoint, routePoint) <= 35,
  );
}

// Создаёт близкие промежуточные точки рядом с основным путём для поиска альтернатив.
function makeSensibleViaPoints(route) {
  const points = route.geometry.coordinates;

  return [0.35, 0.65].flatMap((fraction) => {
    const index = Math.round((points.length - 1) * fraction);
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[Math.min(points.length - 1, index + 1)];
    const longitudeDirection = next[0] - previous[0];
    const latitudeDirection = next[1] - previous[1];
    const length = Math.hypot(longitudeDirection, latitudeDirection) || 1;

    // Небольшое смещение в стороны от пути — вместо случайной точки в другом квартале.
    const longitudeOffset = (-latitudeDirection / length) * 0.0012;
    const latitudeOffset = (longitudeDirection / length) * 0.001;

    return [
      [current[1] + latitudeOffset, current[0] + longitudeOffset],
      [current[1] - latitudeOffset, current[0] - longitudeOffset],
    ];
  });
}

// Подбирает дополнительные варианты и отбрасывает почти одинаковые или слишком длинные пути.
async function expandReasonableRoutes(startPoint, initialRoutes, controller) {
  const collectedRoutes = [...initialRoutes];
  const baseRoute = initialRoutes.reduce((bestRoute, route) =>
    route.distance < bestRoute.distance ? route : bestRoute,
  );

  try {
    for (const viaPoint of makeSensibleViaPoints(baseRoute)) {
      if (
        controller.signal.aborted ||
        collectedRoutes.length >= maximumReasonableRoutes
      ) {
        break;
      }

      try {
        const data = await requestRoutes(
          startPoint,
          controller.signal,
          viaPoint,
        );

        (data.routes ?? []).forEach((candidate) => {
          const hasSameSignature = collectedRoutes.some(
            (route) => routeSignature(route) === routeSignature(candidate),
          );

          if (
            candidate.geometry?.coordinates?.length &&
            !hasSameSignature &&
            isMeaningfullyDifferent(candidate, collectedRoutes)
          ) {
            collectedRoutes.push(candidate);
          }
        });

        const reasonableRoutes = filterReasonableRoutes(
          collectedRoutes.filter(
            (route) => route.geometry?.coordinates?.length,
          ),
        ).slice(0, maximumReasonableRoutes);

        if (reasonableRoutes.length > routeVariants.length) {
          const selectedSignature = routeVariants[selectedRouteIndex]
            ? routeSignature(routeVariants[selectedRouteIndex].route)
            : null;

          routeVariants = assessRoutes(reasonableRoutes);
          const nextIndex = routeVariants.findIndex(
            (variant) => routeSignature(variant.route) === selectedSignature,
          );
          selectedRouteIndex = nextIndex >= 0 ? nextIndex : 0;
          renderRouteOptions();
          showSelectedRoute(selectedRouteIndex, false);
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }
      }
    }
  } finally {
    if (!controller.signal.aborted) {
      setProgress("done");
      setStatus(
        `Готово: найдено осмысленных вариантов маршрута — ${routeVariants.length}.`,
      );
    }

    if (activeRouteRequest === controller) {
      activeRouteRequest = null;
    }
  }
}
// Оценивает положение объекта вдоль маршрута в метрах от его начала.
function getDistanceAlongRoute(objectPoint, routePoints) {
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  let distanceFromStart = 0;

  for (let index = 0; index < routePoints.length; index += 1) {
    const distanceToObject = haversineDistance(objectPoint, routePoints[index]);

    if (distanceToObject < nearestDistance) {
      nearestDistance = distanceToObject;
      nearestIndex = index;
    }
  }

  for (let index = 1; index <= nearestIndex; index += 1) {
    distanceFromStart += haversineDistance(
      routePoints[index - 1],
      routePoints[index],
    );
  }

  return distanceFromStart;
}

// Не даёт выводить одинаковые ограничения скорости чаще одного раза на заданном отрезке пути.
function limitSpeedSignsByRouteDistance(
  objects,
  routePoints,
  minimumSpacing = 300,
) {
  const otherObjects = objects.filter((item) => item.type !== "speed");
  const speedObjects = objects
    .filter((item) => item.type === "speed")
    .map((item) => ({
      item,
      routeDistance: getDistanceAlongRoute(item.point, routePoints),
    }))
    .sort((first, second) => first.routeDistance - second.routeDistance);
  const acceptedSpeedSigns = [];

  speedObjects.forEach((candidate) => {
    const isFarEnough = acceptedSpeedSigns.every(
      (accepted) =>
        Math.abs(accepted.routeDistance - candidate.routeDistance) >=
        minimumSpacing,
    );

    if (isFarEnough) {
      acceptedSpeedSigns.push(candidate);
    }
  });

  return [...otherObjects, ...acceptedSpeedSigns.map(({ item }) => item)];
}
// Загружает реальные переходы и светофоры, размеченные в OpenStreetMap, через Overpass API.
async function loadSafetyObjects(route) {
  const cacheKey = routeSignature(route);

  if (safetyObjectsCache.has(cacheKey)) {
    return safetyObjectsCache.get(cacheKey);
  }

  const [south, west, north, east] = getRouteBounds(route.geometry.coordinates);
  // Запрашиваем только точки: их достаточно для светофоров и большинства переходов,
  // а ответ получается заметно быстрее, чем при поиске ещё и линий/полигонов.
  const query = `
    [out:json][timeout:6];
    (
      node["highway"="traffic_signals"](${south},${west},${north},${east});
      node["highway"="crossing"](${south},${west},${north},${east});
      node["crossing"](${south},${west},${north},${east});
      way["maxspeed"~"^(20|30|40|50|60)$"](${south},${west},${north},${east});
    );
    out center qt;
  `;
  const response = await fetch(overpassService, {
    method: "POST",
    body: query,
    signal: activeSafetyRequest.signal,
  });

  if (!response.ok) {
    throw new Error(`Overpass API вернул код ${response.status}`);
  }

  const data = await response.json();
  const uniqueObjects = new Map();

  (data.elements ?? []).forEach((element) => {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (latitude === undefined || longitude === undefined) {
      return;
    }

    const tags = element.tags ?? {};
    let type = "crossing";
    let symbol = "🚶";
    let title = "Пешеходный переход";

    if (tags.highway === "traffic_signals") {
      type = "light";
      symbol = "🚦";
      title = "Светофор";
    } else if (tags.maxspeed) {
      type = "speed";
      symbol = tags.maxspeed;
      title = `Ограничение скорости: ${tags.maxspeed} км/ч`;
    }

    const key = `${type}:${latitude.toFixed(6)}:${longitude.toFixed(6)}`;

    uniqueObjects.set(key, {
      point: [longitude, latitude],
      type,
      symbol,
      title,
    });
  });

  const nearbyObjects = [...uniqueObjects.values()].filter((item) => {
    // У maxspeed координата — центр дорожного участка, поэтому допускаем больший радиус.
    const maximumDistance = item.type === "speed" ? 120 : 35;
    return isObjectNearRoute(
      item.point,
      route.geometry.coordinates,
      maximumDistance,
    );
  });

  // На длинных дорогах maxspeed повторяется у соседних сегментов: оставляем знак раз в 300 м пути.
  const objectsWithLimitedSpeedSigns = limitSpeedSignsByRouteDistance(
    nearbyObjects,
    route.geometry.coordinates,
  );

  safetyObjectsCache.set(cacheKey, objectsWithLimitedSpeedSigns);
  return objectsWithLimitedSpeedSigns;
}

// Просит Leaflet сразу пересчитать позиции новых маркеров после асинхронного ответа Overpass.
function refreshSafetyMarkers() {
  requestAnimationFrame(() => {
    safetyMarkers.forEach((marker) => marker.update());
    map.invalidateSize({ pan: false, debounceMoveend: true });
  });
}
// Показывает на карте только реальные объекты OSM, расположенные рядом с выбранным маршрутом.
async function drawSafetyMarkers(variant) {
  clearSafetyMarkers();

  const controller = new AbortController();
  activeSafetyRequest = controller;
  const routeKey = routeSignature(variant.route);

  try {
    const objects = await loadSafetyObjects(variant.route);

    // Пользователь мог уже выбрать другой вариант, пока шёл запрос к Overpass.
    if (
      controller.signal.aborted ||
      routeKey !== routeSignature(routeVariants[selectedRouteIndex].route)
    ) {
      return;
    }

    objects.forEach((item) => {
      const marker = L.marker([item.point[1], item.point[0]], {
        icon: createSafetyIcon(item.symbol, item.type),
        // Светофор важнее визуально и должен перекрывать переход при совпадении точек.
        zIndexOffset: item.type === "light" ? 1000 : 0,
      }).addTo(map);

      // В прототипе оставляем место под будущую фотографию реального участка.
      marker.bindPopup(`
        <div class="safety-popup">
          <strong>${item.title}</strong>
          <div class="safety-photo-placeholder" aria-label="Заглушка фотографии участка">
            <span aria-hidden="true">📷</span>
            <small>Фото участка</small>
          </div>
        </div>
      `);

      safetyMarkers.push(marker);
    });

    refreshSafetyMarkers();
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("Не удалось загрузить объекты безопасности из OSM:", error);
    }
  } finally {
    if (activeSafetyRequest === controller) {
      activeSafetyRequest = null;
    }
  }
}
// На карте показывается только выбранный вариант, чтобы линии не перекрывали друг друга.
function drawRouteVariants() {
  clearRouteLayers();
  routeLine = null;

  const variant = routeVariants[selectedRouteIndex];

  if (!variant) {
    return;
  }

  const coordinates = getRouteCoordinates(variant);
  const outline = L.polyline(coordinates, {
    color: "#ffffff",
    weight: 12,
    opacity: 0.96,
    interactive: false,
    lineCap: "butt",
    lineJoin: "miter",
    smoothFactor: 0,
  }).addTo(map);
  const line = L.polyline(coordinates, {
    color: variant.color,
    weight: 7,
    opacity: 0.98,
    lineCap: "butt",
    lineJoin: "miter",
    smoothFactor: 0,
  }).addTo(map);

  routeLayers.push(outline, line);
  routeLine = line;
  void drawSafetyMarkers(variant);
}
// Синхронизирует выбранный маршрут на карте, в списке и в текстовом объяснении.
function showSelectedRoute(index, shouldFit = true) {
  selectedRouteIndex = index;
  const variant = routeVariants[index];

  drawRouteVariants();

  document.querySelectorAll(".route").forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === index);
  });

  updateRouteReasons(variant);
  setStatus(`Выбран вариант: ${variant.level.toLowerCase()}.`);

  if (routeLine && shouldFit) {
    map.fitBounds(routeLine.getBounds().pad(0.18));
  }
}

// Создаёт кнопки вариантов через DOM API, чтобы внешний текст не вставлялся как HTML.
function renderRouteOptions() {
  optionsElement.replaceChildren();

  routeVariants.forEach((variant, index) => {
    const button = document.createElement("button");
    const topLine = document.createElement("span");
    const title = document.createElement("span");
    const badge = document.createElement("span");
    const details = document.createElement("small");

    button.className = "route";
    button.type = "button";
    topLine.className = "route-top";
    title.textContent = `Вариант ${index + 1}`;
    badge.className = `badge ${variant.badgeClass}`;
    badge.textContent = variant.level;
    details.textContent = `${formatDistance(variant.route.distance)} · ${formatDuration(variant.route.duration)} · ${variant.intersections} пересечений`;

    topLine.append(title, badge);
    button.append(topLine, details);
    button.addEventListener("click", () => showSelectedRoute(index));
    optionsElement.appendChild(button);
  });

  optionsSection.hidden = false;
  updateManualSignsPanelVisibility();
}
// Главный сценарий: отменяет старый запрос, строит первый путь и затем ищет альтернативы.
async function buildRoute(clickedPoint) {
  if (activeRouteRequest) {
    activeRouteRequest.abort();
  }

  const controller = new AbortController();
  activeRouteRequest = controller;
  clearManualSigns();
  optionsSection.hidden = true;
  updateManualSignsPanelVisibility();
  routeReasonsElement.hidden = true;
  setProgress("point");
  setStatus("Определяю точку отправления…");

  try {
    setProgress("route");
    setStatus("Строю пешеходные маршруты…");
    const directData = await requestRoutes(
      clickedPoint,
      controller.signal,
      null,
      "true",
    );
    const routes = filterReasonableRoutes(
      (directData.routes ?? []).filter(
        (route) => route.geometry?.coordinates?.length,
      ),
    );

    if (!routes.length) {
      throw new Error("Пешеходный маршрут не найден");
    }

    const snappedStart = directData.waypoints?.[0]?.location;

    if (snappedStart) {
      const snappedPoint = [snappedStart[1], snappedStart[0]];

      if (startMarker) {
        startMarker.setLatLng(snappedPoint);
        startMarker.setZIndexOffset(3000);
      } else {
        startMarker = L.marker(snappedPoint, {
          icon: startIcon,
          zIndexOffset: 3000,
        }).addTo(map);
        clearStartButton.hidden = false;
      }
    }

    setProgress("score");
    setStatus("Оцениваю варианты маршрута…");
    routeVariants = assessRoutes(routes);
    selectedRouteIndex = 0;
    renderRouteOptions();
    showSelectedRoute(selectedRouteIndex);

    if (routeVariants.length < maximumReasonableRoutes) {
      setStatus(
        `Найдено ${routeVariants.length} вариантов. Ищу ещё подходящие…`,
      );
      void expandReasonableRoutes(clickedPoint, routes, controller);
    } else {
      setProgress("done");
      setStatus(
        `Готово: найдено осмысленных вариантов маршрута — ${routeVariants.length}.`,
      );
      activeRouteRequest = null;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    console.error("Ошибка построения маршрута:", error);
    routeVariants = [];
    clearRouteLayers();
    optionsSection.hidden = true;
    updateManualSignsPanelVisibility();
    setProgress("failed");
    setStatus(getRoutingErrorMessage(error));

    if (activeRouteRequest === controller) {
      activeRouteRequest = null;
    }
  }
}
// Приводит адресный запрос к единому виду для более мягкого сравнения улиц.
function normalizeAddressSearchText(value) {
  return normalizeOsmText(value)
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/\bул\.?\b|\bулица\b/g, " улица ")
    .replace(/\bпр\.?\b|\bпр-т\b|\bпросп\.?\b|\bпроспект\b/g, " проспект ")
    .replace(/\bпер\.?\b|\bпереулок\b/g, " переулок ")
    .replace(/\bбул\.?\b|\bбульвар\b/g, " бульвар ")
    .replace(/\bш\.?\b|\bшоссе\b/g, " шоссе ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Достаёт номер дома из запроса, чтобы точнее поднимать результаты с тем же домом.
function extractHouseNumber(value) {
  return normalizeAddressSearchText(value).match(/\b\d+[а-яa-z]?\b/i)?.[0] ?? "";
}

// Убирает типовые слова адреса, оставляя смысловые части: название улицы и номер дома.
function getAddressMeaningfulWords(value) {
  const ignoredWords = new Set([
    "улица",
    "проспект",
    "переулок",
    "бульвар",
    "шоссе",
    "хабаровск",
    "город",
    "г",
  ]);

  return normalizeAddressSearchText(value)
    .split(" ")
    .filter((word) => word && !ignoredWords.has(word));
}

// Делает более простой вариант запроса для повторной попытки, если геокодер не понял исходный ввод.
function makeAddressFallbackQuery(query) {
  const words = getAddressMeaningfulWords(query);
  return words.length ? words.join(" ") : normalizeAddressSearchText(query);
}

// Оценивает результат Nominatim по похожести на пользовательский ввод.
function scoreAddressSearchResult(place, query) {
  const normalizedQuery = normalizeAddressSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const displayName = place.display_name ?? "";
  const normalizedName = normalizeAddressSearchText(displayName);
  const queryHouse = extractHouseNumber(query);
  const resultHouse = extractHouseNumber(displayName);

  if (normalizedName.includes(normalizedQuery)) {
    return queryHouse && resultHouse === queryHouse ? 0 : 1;
  }

  const queryWords = getAddressMeaningfulWords(query);
  const resultWords = getAddressMeaningfulWords(displayName);
  const everyWordHasSimilarMatch = queryWords.every((queryWord) => (
    resultWords.some((resultWord) => {
      if (resultWord.includes(queryWord) || queryWord.includes(resultWord)) {
        return true;
      }

      const allowedDistance = queryWord.length <= 4 ? 1 : 2;
      return getLevenshteinDistance(queryWord, resultWord) <= allowedDistance;
    })
  ));

  if (everyWordHasSimilarMatch) {
    return queryHouse && resultHouse === queryHouse ? 2 : 3;
  }

  return Infinity;
}

// Убирает дубликаты и сортирует адресные подсказки по похожести, а не только по порядку API.
function rankAddressSuggestions(places, query) {
  const uniquePlaces = new Map();

  places.forEach((place) => {
    const key = `${place.lat}:${place.lon}:${place.display_name}`;
    uniquePlaces.set(key, place);
  });

  return [...uniquePlaces.values()]
    .map((place, index) => ({
      place,
      index,
      score: scoreAddressSearchResult(place, query),
    }))
    .sort((first, second) => {
      const firstScore = Number.isFinite(first.score) ? first.score : 99;
      const secondScore = Number.isFinite(second.score) ? second.score : 99;
      return firstScore - secondScore || first.index - second.index;
    })
    .map(({ place }) => place);
}
// Ищет адреса в Хабаровске через Nominatim; в промышленном проекте нужен отдельный геокодер.
async function findAddress(query) {
  if (activeAddressRequest) {
    activeAddressRequest.abort();
  }

  const controller = new AbortController();
  activeAddressRequest = controller;
  const parameters = new URLSearchParams({
    q: `${query}, Хабаровск`,
    format: "jsonv2",
    limit: "30",
    countrycodes: "ru",
  });

  try {
    const response = await fetch(`${geocodingService}?${parameters}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Геокодер вернул код ${response.status}`);
    }

    return response.json();
  } finally {
    // Старый запрос не должен очищать ссылку на более новый активный запрос.
    if (activeAddressRequest === controller) {
      activeAddressRequest = null;
    }
  }
}

// Очищает результаты поиска перед новым вводом или после выбора адреса.
function clearAddressSuggestions() {
  suggestionsElement.replaceChildren();
  suggestionsElement.hidden = true;
}

// Передаёт найденный адрес в тот же механизм, что и клик пользователя по карте.
function selectAddress(place) {
  const point = L.latLng(Number(place.lat), Number(place.lon));

  addressInput.value = place.display_name.split(",").slice(0, 3).join(",");
  clearAddressSuggestions();
  map.setView(point, 16);
  buildRoute(point);
}

// Отображает выпадающий список адресов и безопасно подсвечивает совпадение.
function showAddressSuggestions(places, query) {
  suggestionsElement.replaceChildren();

  places.forEach((place) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "address-suggestion";
    button.role = "option";
    const lowerName = place.display_name.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    const matchIndex = lowerName.indexOf(lowerQuery);

    if (matchIndex >= 0) {
      button.append(place.display_name.slice(0, matchIndex));
      const match = document.createElement("mark");
      match.textContent = place.display_name.slice(
        matchIndex,
        matchIndex + query.length,
      );
      button.append(match, place.display_name.slice(matchIndex + query.length));
    } else {
      button.textContent = place.display_name;
    }

    button.addEventListener("click", () => selectAddress(place));
    suggestionsElement.appendChild(button);
  });

  suggestionsElement.hidden = false;
}

// Выполняет поиск адреса и игнорирует ответ, если пользователь уже изменил запрос.
async function searchAddressSuggestions(query) {
  if (query.length < 1) {
    clearAddressSuggestions();
    return;
  }

  setStatus("Ищу адрес в OpenStreetMap…");

  try {
    let places = await findAddress(query);

    if (!places.length) {
      const fallbackQuery = makeAddressFallbackQuery(query);

      if (fallbackQuery && fallbackQuery !== normalizeAddressSearchText(query)) {
        places = await findAddress(fallbackQuery);
      }
    }

    if (addressInput.value.trim() !== query) {
      return;
    }

    const rankedPlaces = rankAddressSuggestions(places, query);

    if (!rankedPlaces.length) {
      clearAddressSuggestions();
      setStatus(
        "Адрес не найден. Продолжите ввод или выберите место на карте.",
      );
      return;
    }

    showAddressSuggestions(rankedPlaces, query);
    setStatus("Выберите подходящий адрес из списка под строкой поиска.");
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    console.error(error);
    setStatus(
      "Не удалось найти адрес. Проверьте интернет или выберите место на карте.",
    );
  } finally {
    activeAddressRequest = null;
  }
}

// Поддерживаем поиск как кнопкой, так и клавишей Enter.
addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(addressSearchTimer);
  void searchAddressSuggestions(addressInput.value.trim());
});
// Автоподсказки запускаются после короткой паузы, чтобы не делать запрос на каждую букву.
addressInput.addEventListener("input", () => {
  clearTimeout(addressSearchTimer);
  clearAddressSuggestions();

  const query = addressInput.value.trim();

  if (query.length < 1) {
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
    const isTextInput = event.target instanceof HTMLElement && Boolean(
      event.target.closest("input, textarea, [contenteditable=\"true\"]"),
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
    signOptionButtons.forEach((item) => item.classList.toggle("is-selected", item === button));
  });
});
initializeSchoolPicker();
// Клик по карте — альтернативный способ выбрать стартовую точку.
map.on("click", (event) => {
  if (isAddingManualSign) {
    addManualSign(event.latlng);
    return;
  }

  buildRoute(event.latlng);
});

// Полностью очищает пользовательскую точку и результат предыдущего построения.
clearStartButton.addEventListener("click", () => {
  if (activeRouteRequest) {
    activeRouteRequest.abort();
  }

  if (startMarker) {
    map.removeLayer(startMarker);
    startMarker = null;
  }

  clearRouteLayers();
  clearSafetyMarkers();
  clearManualSigns();
  routeVariants = [];
  selectedRouteIndex = 0;
  routeReasonsElement.hidden = true;
  optionsSection.hidden = true;
  updateManualSignsPanelVisibility();
  setProgress("idle");
  setStatus(
    "Точка отправления удалена. Выберите новое место на карте или введите адрес.",
  );
  clearStartButton.hidden = true;
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










/*  */







