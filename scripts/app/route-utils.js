/* Общие функции маршрутов: статусы, форматирование, запросы и подбор вариантов. */
// Показывает пользователю краткое сообщение о текущем состоянии приложения.
function setStatus(message) {
  statusElement.textContent = message;
}

// Управляет этапами построения: активный этап крутится, завершённый получает галочку.
// Если построение сорвалось, последний активный этап получает красный крестик без анимации.
function setProgress(stage) {
  const stages = ["point", "route", "variants"];

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
        stage === "failed"
          ? index < failedIndex
          : index < activeIndex || stage === "done",
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

// Объединяет результаты разных запросов, не допуская одинаковой геометрии.
function mergeUniqueRoutes(...routeGroups) {
  const uniqueRoutes = new Map();

  routeGroups.flat().forEach((route) => {
    if (route?.geometry?.coordinates?.length) {
      uniqueRoutes.set(routeSignature(route), route);
    }
  });

  return [...uniqueRoutes.values()];
}

// Если обычный ответ проходит через красную линию, запрашивает варианты по обе стороны от неё.
async function requestDangerRoadDetours(start, sourceRoutes, signal) {
  const viaPoints = makeDangerRoadDetourPoints(sourceRoutes);

  if (!viaPoints.length) return [];

  const results = await Promise.allSettled(
    viaPoints.map((viaPoint) => requestRoutes(start, signal, viaPoint)),
  );

  return filterRoutesAvoidingFixedDangerRoads(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value.routes ?? [] : [],
    ),
  );
}

// Убирает пути, которые больше чем на 25% длиннее или медленнее лучшего варианта.
function filterReasonableRoutes(routes) {
  if (!routes.length) return [];

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
