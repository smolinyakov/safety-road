/* Выбор школы: локальная база, нечёткий поиск и перенос карты к выбранной школе. */
// Инициализирует выпадающий список из локальной базы учреждений.
function initializeSchoolPicker() {
  selectedSchool =
    khabarovskSchools.find((item) => /№\s*85|#\s*85|\b85\b/i.test(item.name)) ??
    selectedSchool;
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
