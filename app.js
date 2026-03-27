const STORAGE_KEY = "ventilation-insights-uploaded-datasets-v1";
const DEFAULT_DATASET = {
  id: "default",
  name: "Original waiting-area run",
  source: "./data/default.csv",
  builtIn: true,
};

const state = {
  datasets: [],
  activeId: null,
  activeMode: "dataset",
  selectedTimelinePoints: {},
};

const tabsEl = document.querySelector("#dataset-tabs");
const uploadPanelEl = document.querySelector("#upload-panel");
const uploadInputEl = document.querySelector("#csv-upload");
const uploadStatusEl = document.querySelector("#upload-status");
const resetUploadEl = document.querySelector("#reset-upload");
const clearUploadsEl = document.querySelector("#clear-uploads");
const dashboardEl = document.querySelector("#dashboard");
const summaryGridEl = document.querySelector("#summary-grid");
const headlineInsightsEl = document.querySelector("#headline-insights");
const interventionListEl = document.querySelector("#intervention-list");
const timelineChartEl = document.querySelector("#timeline-chart");
const hourlyChartEl = document.querySelector("#hourly-chart");
const episodeTableEl = document.querySelector("#episode-table");
const dailyTableEl = document.querySelector("#daily-table");

bootstrap().catch((error) => {
  console.error(error);
  uploadStatusEl.textContent = "The dashboard could not load the default dataset. You can still upload a CSV.";
  showUploadPanel();
});

async function bootstrap() {
  const baseCsv = await fetch(DEFAULT_DATASET.source).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load default dataset: ${response.status}`);
    }

    return response.text();
  });

  const defaultDataset = buildDataset(DEFAULT_DATASET.id, DEFAULT_DATASET.name, baseCsv, {
    builtIn: true,
  });
  const uploadedDatasets = loadStoredDatasets()
    .map((entry) => buildDataset(entry.id, entry.name, entry.csvText))
    .filter(Boolean);

  state.datasets = [defaultDataset, ...uploadedDatasets].filter(Boolean);
  state.activeId = defaultDataset?.id ?? state.datasets[0]?.id ?? null;
  renderTabs();
  renderActiveDataset();
  bindUploadEvents();
}

function bindUploadEvents() {
  uploadInputEl.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    processUploadFile(file);
    uploadInputEl.value = "";
  });

  const dropzone = document.querySelector(".upload-dropzone");
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", async (event) => {
    const [file] = event.dataTransfer?.files || [];
    if (!file) {
      return;
    }

    processUploadFile(file);
  });

  resetUploadEl.addEventListener("click", () => {
    resetUploadForm();
  });

  clearUploadsEl.addEventListener("click", () => {
    removeAllUploadedDatasets();
  });
}

async function processUploadFile(file) {
  const text = await file.text();
  const baseName = file.name.replace(/\.[^.]+$/, "") || "Uploaded dataset";
  const datasetId = `${slugify(baseName)}-${Date.now()}`;
  const dataset = buildDataset(datasetId, baseName, text);

  if (!dataset) {
    uploadStatusEl.textContent = "That CSV could not be parsed. Check the DATE, TIME, and CO2 columns.";
    return;
  }

  state.datasets.push(dataset);
  persistUploadedDatasets();
  state.activeId = dataset.id;
  state.activeMode = "dataset";
  uploadStatusEl.textContent = `"${dataset.name}" added as a new analysis tab.`;
  renderTabs();
  renderActiveDataset();
}

function buildDataset(id, name, csvText, options = {}) {
  const records = parseCsv(csvText);
  if (!records.length) {
    return null;
  }

  const analysis = analyzeDataset(records);
  return {
    id,
    name,
    csvText,
    builtIn: Boolean(options.builtIn),
    records,
    analysis,
  };
}

function parseCsv(csvText) {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => splitCsvLine(line));

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].map((header) => header.trim().toUpperCase());
  const getIndex = (...names) => headers.findIndex((header) => names.includes(header));
  const dateIndex = getIndex("DATE");
  const timeIndex = getIndex("TIME");
  const timestampIndex = getIndex("TIMESTAMP", "DATETIME", "DATE_TIME");
  const co2Index = getIndex("CO2", "CO₂", "CARBON_DIOXIDE");
  const tempIndex = getIndex("TEMP", "TEMPERATURE");
  const humidityIndex = getIndex("HUMIDITY", "RH");

  if (co2Index === -1 || (timestampIndex === -1 && (dateIndex === -1 || timeIndex === -1))) {
    return [];
  }

  return lines
    .slice(1)
    .map((row) => {
      const rawTimestamp =
        timestampIndex !== -1
          ? row[timestampIndex]
          : `${row[dateIndex] || ""}T${row[timeIndex] || ""}`;
      const timestamp = new Date(rawTimestamp);
      const co2 = Number.parseFloat(row[co2Index]);
      const temp = tempIndex === -1 ? null : Number.parseFloat(row[tempIndex]);
      const humidity = humidityIndex === -1 ? null : Number.parseFloat(row[humidityIndex]);

      if (Number.isNaN(timestamp.getTime()) || Number.isNaN(co2)) {
        return null;
      }

      return {
        timestamp,
        co2,
        temp: Number.isNaN(temp) ? null : temp,
        humidity: Number.isNaN(humidity) ? null : humidity,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function analyzeDataset(records) {
  const co2Values = records.map((record) => record.co2);
  const thresholds = [800, 1000, 1200];
  const maxRecord = records.reduce((best, record) => (record.co2 > best.co2 ? record : best), records[0]);
  const minRecord = records.reduce((best, record) => (record.co2 < best.co2 ? record : best), records[0]);
  const avg = mean(co2Values);
  const byDay = groupBy(records, (record) => dayKey(record.timestamp));
  const byHour = groupBy(records, (record) => record.timestamp.getHours());
  const episodes800 = findEpisodes(records, 800);
  const episodes1000 = findEpisodes(records, 1000);
  const episodes1200 = findEpisodes(records, 1200);
  const fastRises = findRapidChanges(records, 120, "rise");
  const fastDrops = findRapidChanges(records, 120, "drop");
  const topHours = [...byHour.entries()]
    .map(([hour, hourRecords]) => ({
      hour,
      avg: mean(hourRecords.map((record) => record.co2)),
      max: Math.max(...hourRecords.map((record) => record.co2)),
      exceedance800Share: hourRecords.filter((record) => record.co2 >= 800).length / hourRecords.length,
      count: hourRecords.length,
    }))
    .sort((left, right) => right.avg - left.avg || right.max - left.max);

  const dailySummaries = [...byDay.entries()]
    .map(([date, dayRecords]) => ({
      date,
      mean: mean(dayRecords.map((record) => record.co2)),
      peak: Math.max(...dayRecords.map((record) => record.co2)),
      atOrAbove800: dayRecords.filter((record) => record.co2 >= 800).length,
      atOrAbove1000: dayRecords.filter((record) => record.co2 >= 1000).length,
      atOrAbove1200: dayRecords.filter((record) => record.co2 >= 1200).length,
      count: dayRecords.length,
    }))
    .sort((left, right) => new Date(left.date) - new Date(right.date));

  const interventionWindows = buildInterventionWindows({
    records,
    topHours,
    episodes800,
    episodes1000,
    episodes1200,
    fastRises,
  });

  const headlineInsights = buildHeadlineInsights({
    records,
    avg,
    maxRecord,
    minRecord,
    thresholds,
    topHours,
    episodes800,
    episodes1000,
    episodes1200,
    dailySummaries,
  });

  return {
    summary: {
      recordCount: records.length,
      start: records[0].timestamp,
      end: records[records.length - 1].timestamp,
      min: minRecord.co2,
      minTime: minRecord.timestamp,
      max: maxRecord.co2,
      maxTime: maxRecord.timestamp,
      avg,
      p95: percentile(co2Values, 0.95),
      aboveThresholds: thresholds.map((threshold) => ({
        threshold,
        count: records.filter((record) => record.co2 >= threshold).length,
      })),
    },
    topHours,
    dailySummaries,
    episodes800,
    episodes1000,
    episodes1200,
    fastRises,
    fastDrops,
    interventionWindows,
    headlineInsights,
  };
}

function buildHeadlineInsights(context) {
  const { records, avg, maxRecord, topHours, episodes800, episodes1000, episodes1200, dailySummaries } = context;
  const threshold800Share = share(records, (record) => record.co2 >= 800);
  const threshold1000Share = share(records, (record) => record.co2 >= 1000);
  const hottestHour = topHours[0];
  const standoutDay = [...dailySummaries].sort((left, right) => right.peak - left.peak)[0];
  const longestEpisode = [...episodes800].sort((left, right) => right.durationMinutes - left.durationMinutes)[0];

  return [
    {
      tone: episodes1200.length ? "signal-high" : "signal-warn",
      title: `${formatPpm(maxRecord.co2)} peak at ${formatDateTime(maxRecord.timestamp)}`,
      body: `The highest CO2 value lands well above the 1000 ppm action zone, suggesting the strongest ventilation stress occurred in late morning.`,
    },
    {
      tone: threshold1000Share > 0.03 ? "signal-high" : "signal-warn",
      title: `${Math.round(threshold1000Share * 100)}% of readings were at or above 1000 ppm`,
      body: `${Math.round(threshold800Share * 100)}% were at or above 800 ppm. That means the waiting area spent a meaningful slice of monitored time in potentially under-ventilated conditions.`,
    },
    {
      tone: "signal-warn",
      title: `${formatHourRange(hottestHour.hour)} is the repeat high-risk hour`,
      body: `This hour averaged ${formatPpm(hottestHour.avg)} and reached ${formatPpm(hottestHour.max)}. It is the clearest candidate for pre-emptive ventilation action before crowding peaks.`,
    },
    {
      tone: standoutDay.peak >= 1000 ? "signal-high" : "signal-safe",
      title: `${standoutDay.date} was the standout day`,
      body: `Daily peak reached ${formatPpm(standoutDay.peak)} and the longest elevated spell lasted ${Math.round(longestEpisode.durationMinutes)} minutes, which is long enough to support targeted staffing or ventilation changes rather than one-off reactions.`,
    },
  ];
}

function buildInterventionWindows(context) {
  const windows = [];
  const { topHours, episodes800, episodes1000, episodes1200, fastRises } = context;
  const sustained800 = [...episodes800]
    .filter((episode) => episode.durationMinutes >= 30)
    .sort((left, right) => right.durationMinutes - left.durationMinutes)[0];
  const sustained1000 = [...episodes1000]
    .filter((episode) => episode.durationMinutes >= 30)
    .sort((left, right) => right.durationMinutes - left.durationMinutes)[0];
  const severeEpisode = episodes1200[0];
  const recurrentHour = topHours[0];
  const rapidRise = fastRises[0];

  if (recurrentHour) {
    windows.push({
      tone: recurrentHour.avg >= 800 ? "signal-high" : "signal-warn",
      title: `Start a ventilation reset before ${formatHourRange(recurrentHour.hour)}`,
      body: `This hour had the highest mean CO2. A pre-emptive step 15 to 30 minutes earlier is more likely to prevent buildup than waiting for the peak itself.`,
    });
  }

  if (sustained800) {
    windows.push({
      tone: sustained800.peak >= 1000 ? "signal-high" : "signal-warn",
      title: `Long elevated spell from ${formatTime(sustained800.start)} to ${formatTime(sustained800.end)}`,
      body: `CO2 stayed above 800 ppm for ${Math.round(sustained800.durationMinutes)} minutes and peaked at ${formatPpm(sustained800.peak)}. This is a strong candidate for door-opening schedules, purging, or queue smoothing.`,
    });
  }

  if (sustained1000) {
    windows.push({
      tone: "signal-high",
      title: `Escalation zone around ${formatTime(sustained1000.peakTime)}`,
      body: `Once the space crossed 1000 ppm it stayed elevated for ${Math.round(sustained1000.durationMinutes)} minutes. This is the window where extra airflow or overflow seating is likely to matter most.`,
    });
  }

  if (severeEpisode) {
    windows.push({
      tone: "signal-high",
      title: `Severe cluster over 1200 ppm`,
      body: `A ${Math.round(severeEpisode.durationMinutes)} minute episode crossed 1200 ppm, peaking at ${formatPpm(severeEpisode.peak)}. That supports treating this interval as a trigger threshold for immediate intervention.`,
    });
  }

  if (rapidRise) {
    windows.push({
      tone: "signal-warn",
      title: `Watch for abrupt occupancy-driven rises`,
      body: `The sharpest jump was ${formatPpm(rapidRise.delta)} in ${rapidRise.minutes.toFixed(1)} minutes, from ${formatTime(rapidRise.start)} to ${formatTime(rapidRise.end)}. A receptionist-side occupancy cue could catch this earlier than periodic manual checks.`,
    });
  }

  return windows.slice(0, 5);
}

function findEpisodes(records, threshold) {
  const episodes = [];
  let current = null;
  let previousTimestamp = null;

  for (const record of records) {
    const isElevated = record.co2 >= threshold;
    const gapMinutes = previousTimestamp ? (record.timestamp - previousTimestamp) / 60000 : 0;

    if (isElevated) {
      if (!current || gapMinutes > 5) {
        if (current) {
          episodes.push(current);
        }

        current = createEpisode(record, threshold);
      } else {
        current.end = record.timestamp;
        current.readings += 1;
        current.peak = Math.max(current.peak, record.co2);
        if (record.co2 >= current.peak) {
          current.peakTime = record.timestamp;
        }
      }
    } else if (current) {
      episodes.push(current);
      current = null;
    }

    previousTimestamp = record.timestamp;
  }

  if (current) {
    episodes.push(current);
  }

  return episodes
    .map((episode) => ({
      ...episode,
      durationMinutes: (episode.end - episode.start) / 60000,
    }))
    .sort((left, right) => right.peak - left.peak || right.durationMinutes - left.durationMinutes);
}

function createEpisode(record, threshold) {
  return {
    threshold,
    start: record.timestamp,
    end: record.timestamp,
    peak: record.co2,
    peakTime: record.timestamp,
    readings: 1,
  };
}

function findRapidChanges(records, deltaThreshold, direction) {
  return records
    .slice(1)
    .map((record, index) => {
      const previous = records[index];
      const minutes = (record.timestamp - previous.timestamp) / 60000;
      const delta = record.co2 - previous.co2;
      return {
        start: previous.timestamp,
        end: record.timestamp,
        minutes,
        delta,
      };
    })
    .filter((change) => change.minutes > 0 && change.minutes <= 5)
    .filter((change) => {
      if (direction === "rise") {
        return change.delta >= deltaThreshold;
      }

      return change.delta <= -deltaThreshold;
    })
    .sort((left, right) =>
      direction === "rise" ? right.delta - left.delta : left.delta - right.delta,
    );
}

function renderTabs() {
  const datasetButtons = state.datasets
    .map(
      (dataset) => `
        <div class="tab-chip">
          <button class="tab-button dataset ${state.activeMode === "dataset" && state.activeId === dataset.id ? "active" : ""}" data-tab-id="${dataset.id}">
            ${escapeHtml(dataset.name)}
          </button>
          ${
            dataset.builtIn
              ? ""
              : `<button type="button" class="tab-remove" aria-label="Remove ${escapeHtml(dataset.name)}" data-remove-id="${dataset.id}">×</button>`
          }
        </div>
      `,
    )
    .join("");

  tabsEl.innerHTML = `
    ${datasetButtons}
    <button class="tab-button upload ${state.activeMode === "upload" ? "active" : ""}" data-tab-id="upload">
      Upload CSV
    </button>
  `;

  tabsEl.querySelectorAll("[data-tab-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-tab-id");
      if (targetId === "upload") {
        showUploadPanel();
        return;
      }

      state.activeMode = "dataset";
      state.activeId = targetId;
      uploadPanelEl.hidden = true;
      renderTabs();
      renderActiveDataset();
    });
  });

  tabsEl.querySelectorAll("[data-remove-id]").forEach((control) => {
    const removeHandler = (event) => {
      event.stopPropagation();
      removeDataset(control.getAttribute("data-remove-id"));
    };

    control.addEventListener("click", removeHandler);
  });
}

function showUploadPanel() {
  state.activeMode = "upload";
  uploadPanelEl.hidden = false;
  dashboardEl.hidden = true;
  renderTabs();
}

function resetUploadForm() {
  uploadInputEl.value = "";
  uploadStatusEl.textContent = "";
  const dropzone = document.querySelector(".upload-dropzone");
  dropzone?.classList.remove("is-dragging");
}

function removeDataset(datasetId) {
  const dataset = state.datasets.find((entry) => entry.id === datasetId);
  if (!dataset || dataset.builtIn) {
    return;
  }

  state.datasets = state.datasets.filter((entry) => entry.id !== datasetId);
  delete state.selectedTimelinePoints[datasetId];
  persistUploadedDatasets();
  uploadStatusEl.textContent = `"${dataset.name}" was removed.`;

  if (state.activeId === datasetId) {
    state.activeId = state.datasets[0]?.id ?? null;
    state.activeMode = state.activeId ? "dataset" : "upload";
  }

  renderTabs();
  if (state.activeMode === "dataset") {
    renderActiveDataset();
  } else {
    showUploadPanel();
  }
}

function removeAllUploadedDatasets() {
  const uploadedIds = state.datasets.filter((dataset) => !dataset.builtIn).map((dataset) => dataset.id);
  if (!uploadedIds.length) {
    uploadStatusEl.textContent = "There are no uploaded tabs to remove.";
    resetUploadForm();
    return;
  }

  state.datasets = state.datasets.filter((dataset) => dataset.builtIn);
  uploadedIds.forEach((datasetId) => {
    delete state.selectedTimelinePoints[datasetId];
  });
  state.activeId = state.datasets[0]?.id ?? null;
  state.activeMode = state.activeId ? "dataset" : "upload";
  persistUploadedDatasets();
  resetUploadForm();
  uploadStatusEl.textContent = "All uploaded tabs were removed.";
  renderTabs();
  renderActiveDataset();
}

function renderActiveDataset() {
  const dataset = state.datasets.find((entry) => entry.id === state.activeId);
  if (!dataset) {
    dashboardEl.hidden = true;
    return;
  }

  uploadPanelEl.hidden = true;
  dashboardEl.hidden = false;
  renderSummary(dataset);
  renderHeadlineInsights(dataset);
  renderInterventions(dataset);
  renderTimelineChart(dataset);
  renderHourlyChart(dataset);
  renderEpisodeTable(dataset);
  renderDailyTable(dataset);
}

function renderSummary(dataset) {
  const { summary } = dataset.analysis;
  const threshold800 = summary.aboveThresholds.find((entry) => entry.threshold === 800);
  const threshold1000 = summary.aboveThresholds.find((entry) => entry.threshold === 1000);
  const threshold1200 = summary.aboveThresholds.find((entry) => entry.threshold === 1200);
  const cards = [
    {
      label: "Peak CO2",
      value: formatPpm(summary.max),
      detail: `${formatDateTime(summary.maxTime)}`,
    },
    {
      label: "Mean CO2",
      value: formatPpm(summary.avg),
      detail: `95th percentile ${formatPpm(summary.p95)}`,
    },
    {
      label: "Readings >= 1000 ppm",
      value: `${Math.round((threshold1000.count / summary.recordCount) * 100)}%`,
      detail: `${threshold1000.count} of ${summary.recordCount} readings`,
    },
    {
      label: "Readings >= 1200 ppm",
      value: `${Math.round((threshold1200.count / summary.recordCount) * 100)}%`,
      detail: `${threshold1200.count} readings, with ${threshold800.count} above 800 ppm`,
    },
  ];

  summaryGridEl.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <span class="summary-label">${card.label}</span>
          <div class="summary-value">${card.value}</div>
          <div class="summary-detail">${card.detail}</div>
        </article>
      `,
    )
    .join("");
}

function renderHeadlineInsights(dataset) {
  headlineInsightsEl.innerHTML = dataset.analysis.headlineInsights
    .map(
      (insight) => `
        <article class="stack-item ${insight.tone}">
          <h3>${escapeHtml(insight.title)}</h3>
          <p>${escapeHtml(insight.body)}</p>
        </article>
      `,
    )
    .join("");
}

function renderInterventions(dataset) {
  if (!dataset.analysis.interventionWindows.length) {
    interventionListEl.innerHTML = `<div class="empty-state">No obvious intervention window was detected in this file yet.</div>`;
    return;
  }

  interventionListEl.innerHTML = dataset.analysis.interventionWindows
    .map(
      (item) => `
        <article class="stack-item ${item.tone}">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `,
    )
    .join("");
}

function renderTimelineChart(dataset) {
  const width = 860;
  const height = 360;
  const margin = { top: 18, right: 24, bottom: 52, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const records = dataset.records;
  const minTime = records[0].timestamp.getTime();
  const maxTime = records[records.length - 1].timestamp.getTime();
  const maxCo2 = Math.max(1300, ...records.map((record) => record.co2));
  const xScale = (value) => margin.left + ((value - minTime) / (maxTime - minTime || 1)) * innerWidth;
  const yScale = (value) => margin.top + innerHeight - (value / maxCo2) * innerHeight;
  const peakIndex = records.reduce(
    (bestIndex, record, index) => (record.co2 > records[bestIndex].co2 ? index : bestIndex),
    0,
  );
  const selectedIndex = state.selectedTimelinePoints[dataset.id] ?? peakIndex;
  const selectedRecord = records[selectedIndex];
  const lineSegments = buildTimelineSegments(records, xScale, yScale);
  const dayNightBands = buildDayNightBands(records[0].timestamp, records[records.length - 1].timestamp, xScale, height, margin);
  const pointsMarkup = records
    .map((record, index) => {
      const isDay = isDaytime(record.timestamp);
      return `
        <circle
          class="timeline-point ${isDay ? "day" : "night"} ${index === selectedIndex ? "selected" : ""}"
          cx="${xScale(record.timestamp.getTime()).toFixed(2)}"
          cy="${yScale(record.co2).toFixed(2)}"
          r="${index === selectedIndex ? 4.8 : 2.4}"
          data-point-index="${index}"
          tabindex="0"
        ></circle>
      `;
    })
    .join("");

  const thresholdMarkup = [
    { value: 800, color: "#d78812", label: "800 ppm" },
    { value: 1000, color: "#c74b2a", label: "1000 ppm" },
    { value: 1200, color: "#8d2710", label: "1200 ppm" },
  ]
    .map(
      (threshold) => `
        <line class="threshold-line" x1="${margin.left}" y1="${yScale(threshold.value)}" x2="${width - margin.right}" y2="${yScale(threshold.value)}" stroke="${threshold.color}"></line>
        <text class="threshold-label" x="${width - margin.right - 4}" y="${yScale(threshold.value) - 6}" text-anchor="end">${threshold.label}</text>
      `,
    )
    .join("");

  const tickValues = 5;
  const xTicks = Array.from({ length: tickValues }, (_, index) => {
    const ratio = index / (tickValues - 1);
    const time = new Date(minTime + ratio * (maxTime - minTime));
    return `
      <line class="grid-line" x1="${margin.left + ratio * innerWidth}" y1="${margin.top}" x2="${margin.left + ratio * innerWidth}" y2="${height - margin.bottom}"></line>
      <text class="axis-label" x="${margin.left + ratio * innerWidth}" y="${height - margin.bottom + 22}" text-anchor="middle">${formatShortDateTime(time)}</text>
    `;
  }).join("");

  const yTicks = [0, 400, 800, 1000, 1200, maxCo2]
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => left - right)
    .map(
      (value) => `
        <line class="grid-line" x1="${margin.left}" y1="${yScale(value)}" x2="${width - margin.right}" y2="${yScale(value)}"></line>
        <text class="axis-label" x="${margin.left - 10}" y="${yScale(value) + 4}" text-anchor="end">${Math.round(value)}</text>
      `,
    )
    .join("");

  timelineChartEl.innerHTML = `
    <div class="timeline-meta">
      <div class="timeline-legend">
        <span class="legend-chip day">Day: 8 AM to 8 PM</span>
        <span class="legend-chip night">Night: 8 PM to 8 AM</span>
      </div>
      <div class="timeline-detail" id="timeline-detail">
        ${renderTimelineDetail(selectedRecord)}
      </div>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="CO2 timeline">
      ${dayNightBands}
      ${yTicks}
      ${xTicks}
      ${thresholdMarkup}
      ${lineSegments
        .map(
          (segment) => `
            <path class="timeline-line ${segment.mode}" d="${segment.path}"></path>
          `,
        )
        .join("")}
      ${pointsMarkup}
      <text class="chart-note" x="${margin.left}" y="${height - 8}">
        ${escapeHtml(dataset.name)} from ${formatDateTime(dataset.analysis.summary.start)} to ${formatDateTime(dataset.analysis.summary.end)}
      </text>
    </svg>
  `;

  bindTimelineInteractions(dataset);
}

function renderHourlyChart(dataset) {
  const width = 640;
  const height = 360;
  const margin = { top: 24, right: 20, bottom: 46, left: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const matching = dataset.analysis.topHours.find((entry) => entry.hour === hour);
    return matching ?? { hour, avg: 0, max: 0, exceedance800Share: 0, count: 0 };
  });
  const maxValue = Math.max(1000, ...hours.map((hour) => hour.avg));
  const barWidth = innerWidth / hours.length - 6;

  const bars = hours
    .map((hour, index) => {
      const x = margin.left + index * (innerWidth / hours.length) + 3;
      const barHeight = (hour.avg / maxValue) * innerHeight;
      const y = margin.top + innerHeight - barHeight;
      const color =
        hour.max >= 1200 ? "#8d2710" : hour.max >= 1000 ? "#c74b2a" : hour.max >= 800 ? "#d78812" : "#2a6c5a";
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="${color}" opacity="0.9"></rect>
        <text class="axis-label" x="${x + barWidth / 2}" y="${height - margin.bottom + 20}" text-anchor="middle">${String(hour.hour).padStart(2, "0")}</text>
      `;
    })
    .join("");

  const yTicks = [0, 400, 800, 1000]
    .map((value) => {
      const y = margin.top + innerHeight - (value / maxValue) * innerHeight;
      return `
        <line class="grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>
        <text class="axis-label" x="${margin.left - 8}" y="${y + 4}" text-anchor="end">${value}</text>
      `;
    })
    .join("");

  hourlyChartEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Average CO2 by hour">
      ${yTicks}
      ${bars}
      <text class="chart-note" x="${margin.left}" y="${height - 8}">
        Bars show hourly average CO2. Color intensifies when the hour also reached higher peak thresholds.
      </text>
    </svg>
  `;
}

function renderEpisodeTable(dataset) {
  const rows = [...dataset.analysis.episodes1200, ...dataset.analysis.episodes1000, ...dataset.analysis.episodes800]
    .sort((left, right) => right.peak - left.peak || right.durationMinutes - left.durationMinutes)
    .slice(0, 8);

  if (!rows.length) {
    episodeTableEl.innerHTML = `<div class="empty-state">No threshold episodes were detected.</div>`;
    return;
  }

  episodeTableEl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Threshold</th>
            <th>Start</th>
            <th>End</th>
            <th>Peak</th>
            <th>Peak time</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (episode) => `
                <tr>
                  <td>${renderPill(episode.threshold)}</td>
                  <td>${formatDateTime(episode.start)}</td>
                  <td>${formatDateTime(episode.end)}</td>
                  <td>${formatPpm(episode.peak)}</td>
                  <td>${formatDateTime(episode.peakTime)}</td>
                  <td>${Math.round(episode.durationMinutes)} min</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDailyTable(dataset) {
  dailyTableEl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Mean</th>
            <th>Peak</th>
            <th>>= 800</th>
            <th>>= 1000</th>
            <th>>= 1200</th>
          </tr>
        </thead>
        <tbody>
          ${dataset.analysis.dailySummaries
            .map(
              (day) => `
                <tr>
                  <td>${day.date}</td>
                  <td>${formatPpm(day.mean)}</td>
                  <td>${formatPpm(day.peak)}</td>
                  <td>${day.atOrAbove800}</td>
                  <td>${day.atOrAbove1000}</td>
                  <td>${day.atOrAbove1200}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function loadStoredDatasets() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function bindTimelineInteractions(dataset) {
  const svg = timelineChartEl.querySelector("svg");
  const detail = timelineChartEl.querySelector("#timeline-detail");
  if (!svg || !detail) {
    return;
  }

  const activatePoint = (pointIndex) => {
    const record = dataset.records[pointIndex];
    if (!record) {
      return;
    }

    state.selectedTimelinePoints[dataset.id] = pointIndex;
    svg.querySelectorAll(".timeline-point.selected").forEach((point) => {
      point.classList.remove("selected");
      point.setAttribute("r", "2.4");
    });
    const selectedPoint = svg.querySelector(`[data-point-index="${pointIndex}"]`);
    if (selectedPoint) {
      selectedPoint.classList.add("selected");
      selectedPoint.setAttribute("r", "4.8");
    }
    detail.innerHTML = renderTimelineDetail(record);
  };

  svg.addEventListener("click", (event) => {
    const point = event.target.closest(".timeline-point");
    if (!point) {
      return;
    }

    activatePoint(Number(point.getAttribute("data-point-index")));
  });

  svg.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const point = event.target.closest(".timeline-point");
    if (!point) {
      return;
    }

    event.preventDefault();
    activatePoint(Number(point.getAttribute("data-point-index")));
  });
}

function buildTimelineSegments(records, xScale, yScale) {
  if (!records.length) {
    return [];
  }

  const segments = [];
  let currentMode = isDaytime(records[0].timestamp) ? "day" : "night";
  let currentPath = [
    `M ${xScale(records[0].timestamp.getTime()).toFixed(2)} ${yScale(records[0].co2).toFixed(2)}`,
  ];

  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const record = records[index];
    const mode = isDaytime(record.timestamp) ? "day" : "night";
    const pointCommand = `L ${xScale(record.timestamp.getTime()).toFixed(2)} ${yScale(record.co2).toFixed(2)}`;

    if (mode === currentMode) {
      currentPath.push(pointCommand);
      continue;
    }

    segments.push({ mode: currentMode, path: currentPath.join(" ") });
    currentMode = mode;
    currentPath = [
      `M ${xScale(previous.timestamp.getTime()).toFixed(2)} ${yScale(previous.co2).toFixed(2)}`,
      pointCommand,
    ];
  }

  segments.push({ mode: currentMode, path: currentPath.join(" ") });
  return segments;
}

function buildDayNightBands(startTime, endTime, xScale, chartHeight, margin) {
  const markup = [];
  let cursor = new Date(startTime);

  while (cursor < endTime) {
    const nextBoundary = nextDayNightBoundary(cursor);
    const segmentEnd = nextBoundary < endTime ? nextBoundary : endTime;
    const x = xScale(cursor.getTime());
    const bandWidth = Math.max(0, xScale(segmentEnd.getTime()) - x);
    markup.push(`
      <rect
        class="day-night-band ${isDaytime(cursor) ? "day" : "night"}"
        x="${x}"
        y="${margin.top}"
        width="${bandWidth}"
        height="${chartHeight - margin.top - margin.bottom}"
      ></rect>
    `);
    cursor = new Date(segmentEnd.getTime());
    cursor.setSeconds(cursor.getSeconds() + 1);
  }

  return markup.join("");
}

function nextDayNightBoundary(date) {
  const boundary = new Date(date);
  boundary.setSeconds(0, 0);
  const hour = boundary.getHours();

  if (hour < 8) {
    boundary.setHours(8, 0, 0, 0);
    return boundary;
  }

  if (hour < 20) {
    boundary.setHours(20, 0, 0, 0);
    return boundary;
  }

  boundary.setDate(boundary.getDate() + 1);
  boundary.setHours(8, 0, 0, 0);
  return boundary;
}

function isDaytime(date) {
  const hour = date.getHours();
  return hour >= 8 && hour < 20;
}

function renderTimelineDetail(record) {
  const metrics = [
    `<strong>${formatPpm(record.co2)}</strong>`,
    `${formatDateTime(record.timestamp)}`,
    isDaytime(record.timestamp) ? "Day period" : "Night period",
  ];

  if (record.temp !== null) {
    metrics.push(`Temp ${record.temp.toFixed(1)} C`);
  }

  if (record.humidity !== null) {
    metrics.push(`Humidity ${record.humidity.toFixed(1)}%`);
  }

  return metrics.join(" · ");
}

function persistUploadedDatasets() {
  const uploaded = state.datasets
    .filter((dataset) => !dataset.builtIn)
    .map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      csvText: dataset.csvText,
    }));

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uploaded));
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function groupBy(items, keyFn) {
  return items.reduce((map, item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
    return map;
  }, new Map());
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.floor((sorted.length - 1) * ratio);
  return sorted[index];
}

function share(items, predicate) {
  return items.filter(predicate).length / items.length;
}

function formatPpm(value) {
  return `${Math.round(value)} ppm`;
}

function formatDateTime(value) {
  return value.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDateTime(value) {
  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

function formatTime(value) {
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHourRange(hour) {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
  return `${start} to ${end}`;
}

function renderPill(threshold) {
  const tone = threshold >= 1200 ? "alert" : threshold >= 1000 ? "warn" : "warn";
  return `<span class="pill ${tone}">>= ${threshold}</span>`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
