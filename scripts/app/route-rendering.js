/* Отрисовка выбранного маршрута, карточек вариантов и основной сценарий построения. */
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
    details.textContent = `${formatDistance(variant.route.distance)} · ${formatDuration(variant.route.duration)}`;

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
    const receivedRoutes = (directData.routes ?? []).filter(
      (route) => route.geometry?.coordinates?.length,
    );
    let routes = filterReasonableRoutes(
      filterRoutesAvoidingFixedDangerRoads(receivedRoutes),
    );

    // Публичный OSRM не принимает зоны запрета напрямую. Если его обычные
    // варианты пересекли красную линию, запрашиваем дополнительные пути через
    // точки по обе стороны от опасного участка и снова проверяем геометрию.
    if (routes.length < maximumReasonableRoutes) {
      setStatus("Ищу путь в обход отмеченных опасных участков…");
      const detours = await requestDangerRoadDetours(
        clickedPoint,
        receivedRoutes,
        controller.signal,
      );
      routes = filterReasonableRoutes(
        mergeUniqueRoutes(routes, detours),
      ).slice(0, maximumReasonableRoutes);
    }

    if (!routes.length) {
      throw new Error("Путь в обход отмеченных опасных участков не найден");
    }

    const snappedStart = directData.waypoints?.[0]?.location;

    if (snappedStart) {
      const snappedPoint = [snappedStart[1], snappedStart[0]];

      if (startMarker) {
        startMarker.setLatLng(snappedPoint);
        // Точка отправления остаётся под школой и дорожными знаками при наложении.
        startMarker.setZIndexOffset(-1000);
      } else {
        startMarker = L.marker(snappedPoint, {
          icon: startIcon,
          zIndexOffset: -1000,
        }).addTo(map);
      }
    }
    document.body.classList.add("has-start-point");
    updateAddressClearVisibility();
    void updateAddressInputFromPoint(startMarker?.getLatLng?.() ?? clickedPoint);

    setProgress("variants");
    setStatus("Подбираю варианты маршрута…");
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


