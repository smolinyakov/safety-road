/* Реальные объекты OSM рядом с маршрутом: Overpass, фильтрация и отображение знаков. */
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
