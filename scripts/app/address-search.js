/* Геокодинг Nominatim, ранжирование и список адресных подсказок. */
// Нормализует запрос перед нечётким сравнением.
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

// Номер дома участвует в ранжировании отдельным признаком.
function extractHouseNumber(value) {
  return (
    normalizeAddressSearchText(value).match(/\b\d+[а-яa-z]?\b/i)?.[0] ?? ""
  );
}

// Оставляет токены, значимые для сравнения адресов.
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

// Строит упрощённый запрос для второй попытки геокодинга.
function makeAddressFallbackQuery(query) {
  const words = getAddressMeaningfulWords(query);
  return words.length ? words.join(" ") : normalizeAddressSearchText(query);
}

// Возвращает score результата относительно исходного запроса.
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
  const everyWordHasSimilarMatch = queryWords.every((queryWord) =>
    resultWords.some((resultWord) => {
      if (resultWord.includes(queryWord) || queryWord.includes(resultWord)) {
        return true;
      }

      const allowedDistance = queryWord.length <= 4 ? 1 : 2;
      return getLevenshteinDistance(queryWord, resultWord) <= allowedDistance;
    }),
  );

  if (everyWordHasSimilarMatch) {
    return queryHouse && resultHouse === queryHouse ? 2 : 3;
  }

  return Infinity;
}

// Дедуплицирует и сортирует результаты по локальному score.
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
// Ограничивает поиск Nominatim Хабаровском.
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
    // Не сбрасываем controller, если уже запущен следующий запрос.
    if (activeAddressRequest === controller) {
      activeAddressRequest = null;
    }
  }
}

// Сбрасывает текущее состояние подсказок.
function clearAddressSuggestions() {
  suggestionsElement.replaceChildren();
  suggestionsElement.hidden = true;
}

// Синхронизирует видимость кнопки очистки.
function updateAddressClearVisibility() {
  if (!addressClearButton) return;
  addressClearButton.hidden = !addressInput.value.trim() && !startMarker;
}

// Собирает короткую подпись из address-полей Nominatim.
function formatReadableAddress(place) {
  if (!place) return "";

  const address = place.address ?? {};
  const road =
    address.road ??
    address.pedestrian ??
    address.footway ??
    address.path ??
    address.neighbourhood ??
    address.suburb;
  const house = address.house_number;
  const city = address.city ?? address.town ?? address.village ?? "Хабаровск";

  if (road && house) return `${road}, ${house}`;
  if (road) return `${road}, ${city}`;

  return (place.display_name ?? "").split(",").slice(0, 3).join(",").trim();
}

// Reverse geocoding для точки, выбранной кликом по карте.
async function updateAddressInputFromPoint(point) {
  if (activeReverseAddressRequest) {
    activeReverseAddressRequest.abort();
  }

  const latlng = L.latLng(point);
  const controller = new AbortController();
  activeReverseAddressRequest = controller;
  const reverseUrl = geocodingService.replace(/\/search$/, "/reverse");
  const parameters = new URLSearchParams({
    lat: String(latlng.lat),
    lon: String(latlng.lng),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
  });

  try {
    const response = await fetch(`${reverseUrl}?${parameters}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Обратный геокодер вернул код ${response.status}`);
    }

    const place = await response.json();

    if (activeReverseAddressRequest !== controller) return;
    const readableAddress = formatReadableAddress(place);

    if (readableAddress) {
      addressInput.value = readableAddress;
      updateAddressClearVisibility();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("Не удалось определить ближайший адрес", error);
    }
  } finally {
    if (activeReverseAddressRequest === controller) {
      activeReverseAddressRequest = null;
    }
  }
}
// Передаёт результат поиска в общий сценарий построения.
function selectAddress(place) {
  const point = L.latLng(Number(place.lat), Number(place.lon));

  addressInput.value = formatReadableAddress(place) || place.display_name.split(",").slice(0, 3).join(",");
  updateAddressClearVisibility();
  clearAddressSuggestions();
  window.setMobileAddressSearchActive?.(false);
  map.setView(point, 16);
  buildRoute(point);
}

// Рендерит подсказки через DOM API без вставки внешнего HTML.
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

// Игнорирует устаревший ответ после изменения строки поиска.
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

      if (
        fallbackQuery &&
        fallbackQuery !== normalizeAddressSearchText(query)
      ) {
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
