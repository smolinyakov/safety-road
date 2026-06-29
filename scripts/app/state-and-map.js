/* Базовая конфигурация, карта Leaflet, DOM-ссылки и общее состояние приложения. */
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
let selectedSchool =
  khabarovskSchools.find((item) => /№\s*85|#\s*85|\b85\b/i.test(item.name)) ??
  defaultSchool;
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

// Для точки отправления и школы используются готовые PNG из папки images.
const schoolIcon = L.icon({
  iconUrl: "images/school.png",
  iconSize: [48, 48],
  iconAnchor: [24, 48],
  popupAnchor: [0, -42],
});

const startIcon = L.icon({
  iconUrl: "images/geo.png",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -34],
});

// Маркер школы постоянный: его нельзя удалить вместе с точкой пользователя.
const schoolMarker = L.marker(school, { icon: schoolIcon }).addTo(map);

// Ссылки на элементы интерфейса получаем один раз после загрузки страницы.
const statusElement = document.getElementById("route-status");
const optionsSection = document.getElementById("route-options-section");
const optionsElement = document.getElementById("route-options");
const addressForm = document.getElementById("address-form");
const addressInput = document.getElementById("address-input");
const addressClearButton = document.getElementById("address-clear");
const suggestionsElement = document.getElementById("address-suggestions");
const routeProgressElement = document.getElementById("route-progress");
const routeReasonsElement = document.getElementById("route-reasons");
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
const sidebar = document.querySelector(".sidebar");
const mobileSheetToggle = document.getElementById("mobile-sheet-toggle");

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
let activeReverseAddressRequest;
let currentProgressStage = "idle";
let isAddingManualSign = false;
let selectedManualSignType = "crossing";
let manualSigns = [];
let shouldRestoreManualSignsFromUrl = false;

// Нормализует текстовый OSM-тег: убирает лишние пробелы и пустые значения.
function normalizeOsmText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}


