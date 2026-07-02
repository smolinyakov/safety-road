/* Конфигурация Leaflet, ссылки на DOM и общее состояние модулей. */
// Школа №85 используется до загрузки локальной базы и как fallback.
const defaultSchool = {
  name: "МБОУ СОШ №85",
  address: "ул. Малиновского, 19 · Хабаровск",
  coordinates: [48.3820134, 135.1191731],
};

// schools-data.js подключается раньше модулей приложения.
let khabarovskSchools = Array.isArray(window.KHABAROVSK_SCHOOLS)
  ? window.KHABAROVSK_SCHOOLS
  : [defaultSchool];

// Текущая школа назначения.
let selectedSchool =
  khabarovskSchools.find((item) => /№\s*85|#\s*85|\b85\b/i.test(item.name)) ??
  defaultSchool;
let school = selectedSchool.coordinates;
// Внешние endpoints маршрутизации, геокодинга и Overpass.
const routingService =
  "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const geocodingService = "https://nominatim.openstreetmap.org/search";
const overpassService = "https://overpass-api.de/api/interpreter";
const maximumReasonableRoutes = 3;

// Начальный viewport привязан к школе по умолчанию.
const map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
}).setView(school, 15.6);

// Атрибуция OSM обязательна; префикс Leaflet не показываем.
L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// Иконки старта и школы хранятся локально в images.
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

// Маркер школы живёт независимо от стартовой точки.
const schoolMarker = L.marker(school, { icon: schoolIcon }).addTo(map);

// DOM-ссылки кэшируем при инициализации модулей.
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

const addSignToggle = document.getElementById("add-sign-toggle");
const signPicker = document.getElementById("sign-picker");
const cancelSignModeButton = document.getElementById("cancel-sign-mode");
const clearManualSignsButton = document.getElementById("clear-manual-signs");
const signOptionButtons = document.querySelectorAll("[data-sign-type]");
const mapArea = document.querySelector(".map-area");
const sidebar = document.querySelector(".sidebar");
const mobileSheetToggle = document.getElementById("mobile-sheet-toggle");

// Состояние маршрута, слоёв и активных сетевых запросов.
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
let selectedManualSignType = "parent-safe";
let manualSigns = [];
let shouldRestoreManualSignsFromUrl = false;

// Нормализует необязательные строковые теги OSM.
function normalizeOsmText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
