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
let currentProgressStage = "idle";
let isAddingManualSign = false;
let selectedManualSignType = "crossing";
let manualSigns = [];
let shouldRestoreManualSignsFromUrl = false;

// Нормализует текстовый OSM-тег: убирает лишние пробелы и пустые значения.
function normalizeOsmText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
