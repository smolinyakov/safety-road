/* Поиск адресов через Nominatim и динамические подсказки. */
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
  return (
    normalizeAddressSearchText(value).match(/\b\d+[а-яa-z]?\b/i)?.[0] ?? ""
  );
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


// Показывает крестик очистки только тогда, когда в поле есть адрес или выбрана точка.
function updateAddressClearVisibility() {
  if (!addressClearButton) return;
  addressClearButton.hidden = !addressInput.value.trim() && !startMarker;
}

// Формирует короткий, читаемый адрес из ответа Nominatim.
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

// По координатам получает ближайший адрес. Это нужно после клика по карте:
// пользователь ставит точку, а поле поиска само показывает понятный адрес.
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
// Передаёт найденный адрес в тот же механизм, что и клик пользователя по карте.
function selectAddress(place) {
  const point = L.latLng(Number(place.lat), Number(place.lon));

  addressInput.value = formatReadableAddress(place) || place.display_name.split(",").slice(0, 3).join(",");
  updateAddressClearVisibility();
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


