/* Выбор школы из локальной базы и нечёткий поиск по названию. */
// Инициализирует список учреждений из schools-data.js.
function initializeSchoolPicker() {
  selectedSchool =
    khabarovskSchools.find((item) => /№\s*85|#\s*85|\b85\b/i.test(item.name)) ??
    selectedSchool;
  school = selectedSchool.coordinates;
  schoolMarker.setLatLng(school);
  updateSelectedSchoolCard();
  renderSchoolList(schoolSearchInput.value);
}
// Синхронизирует верхнюю карточку с выбранной школой.
function updateSelectedSchoolCard() {
  selectedSchoolNameElement.textContent = selectedSchool.name;
  selectedSchoolAddressElement.textContent = selectedSchool.address;
}

// Переключает dropdown выбора школы.
function setSchoolPickerOpen(isOpen) {
  schoolPickerPanel.hidden = !isOpen;
  schoolPickerButton.setAttribute("aria-expanded", String(isOpen));
  // На мобильном класс разводит dropdown школы и нижнюю панель.
  document.body.classList.toggle("is-school-picker-open", isOpen);

  if (isOpen) {
    schoolSearchInput.focus({ preventScroll: true });
    renderSchoolList(schoolSearchInput.value);
  }
}

// Нормализует название перед сравнением.
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

// Извлекает номер учреждения как отдельный критерий поиска.
function extractSchoolNumber(value) {
  return normalizeSchoolSearchText(value).match(/#?\s*(\d{1,3})/)?.[1] ?? "";
}

// Расстояние Левенштейна учитывает опечатки в названии.
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

// Чем ниже score, тем выше учреждение в выдаче.
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

// Возвращает учреждения по возрастанию локального score.
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
// Рендерит отфильтрованный список учреждений.
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

// Меняет точку назначения и центрирует карту.
function selectSchool(schoolItem) {
  clearManualSigns();
  selectedSchool = schoolItem;
  school = schoolItem.coordinates;
  schoolMarker.setLatLng(school);
  updateSelectedSchoolCard();
  setSchoolPickerOpen(false);
  map.setView(school, 16);

  // Существующий маршрут перестраивается к новой школе.
  if (startMarker) {
    buildRoute(startMarker.getLatLng());
  } else {
    setStatus(
      `Выбрана школа: ${selectedSchool.name}. Теперь укажите точку отправления.`,
    );
  }
}
