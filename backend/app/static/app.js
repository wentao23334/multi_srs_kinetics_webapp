const folderPathInput = document.getElementById("folderPathInput");
const applyFolderBtn = document.getElementById("applyFolderBtn");
const folderMsg = document.getElementById("folderMsg");
const fileListContainer = document.getElementById("fileListContainer");

// Currently disabled as they're placeholders
const extractAllBtn = document.getElementById("extractAllBtn");

let currentFolderPath = "";
let foundSrsFiles = [];

let selectedFiles = [];

function setMsg(msg, isError = false) {
    folderMsg.textContent = msg;
    folderMsg.style.color = isError ? "#c63232" : "#605f63";
}

applyFolderBtn.addEventListener("click", async () => {
    const path = folderPathInput.value.trim();
    if (!path) {
        setMsg("Please enter a valid folder path.", true);
        return;
    }

    applyFolderBtn.disabled = true;
    setMsg("Scanning folder...");
    fileListContainer.innerHTML = '<em>Loading...</em>';

    try {
        const resp = await fetch("/api/list_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_path: path })
        });

        const body = await resp.json();
        if (!resp.ok) throw new Error(body.detail || "Failed to scan folder");

        currentFolderPath = body.folder_path;
        foundSrsFiles = body.files;
        selectedFiles = [];

        if (foundSrsFiles.length === 0) {
            fileListContainer.innerHTML = '<em>No .srs files found in this directory.</em>';
            setMsg(`Scanned: ${currentFolderPath} (0 files)`);
            extractAllBtn.disabled = true;
        } else {
            let html = ``;

            html += `<div class="list-item" style="border-bottom: 1px solid var(--border-subtle); border-radius: 0;">
                       <label class="list-content" style="cursor: pointer; display: flex; gap: 12px; width: 100%; margin: 0; padding: 0;">
                         <input type="checkbox" id="selectAllCb" style="margin: 0; cursor: pointer;"/>
                         <span class="item-name" style="font-weight: 700;">全选 (按默认次序)</span>
                       </label>
                     </div>`;

            for (const file of foundSrsFiles) {
                html += `<div class="list-item">
                           <label class="list-content" style="cursor: pointer; display: flex; gap: 12px; width: 100%; margin: 0; padding: 0;">
                             <input type="checkbox" class="file-checkbox" value="${file}" style="margin: 0; cursor: pointer;"/>
                             <span class="item-name">${file}</span>
                           </label>
                         </div>`;
            }

            fileListContainer.innerHTML = html;
            setMsg(`Success: Found ${foundSrsFiles.length} files.`);

            const allCbs = document.querySelectorAll(".file-checkbox");
            const selectAllCb = document.getElementById("selectAllCb");

            // Handle individual file checkboxes
            allCbs.forEach(cb => {
                cb.addEventListener("change", (e) => {
                    const val = e.target.value;
                    if (e.target.checked) {
                        if (!selectedFiles.includes(val)) {
                            selectedFiles.push(val);
                        }
                    } else {
                        selectedFiles = selectedFiles.filter(item => item !== val);
                    }

                    // Update select-all checkbox UI state WITHOUT triggering its event
                    extractAllBtn.disabled = selectedFiles.length === 0;
                });
            });

            // Handle select-all checkbox (using click to avoid programmatic trigger loops)
            selectAllCb.addEventListener("click", (e) => {
                const isChecked = e.target.checked;

                if (isChecked) {
                    // When "select all" is explicitly clicked, use default order
                    selectedFiles = [...foundSrsFiles];
                } else {
                    // Clear all
                    selectedFiles = [];
                }

                // Programmatically uncheck/check all individual UI checkboxes 
                // (this doesn't fire their 'change' event so order won't double update)
                allCbs.forEach(cb => {
                    cb.checked = isChecked;
                });

                extractAllBtn.disabled = selectedFiles.length === 0;
            });

        }
    } catch (err) {
        setMsg(err.message, true);
        fileListContainer.innerHTML = '<em>Error loading files.</em>';
    } finally {
        applyFolderBtn.disabled = false;
    }
});

// ── Waterfall helpers (ported from srs_kinetics_webapp) ──────────────────────

let currentRunId = null;
let currentDataset = null;
let currentKineticsDataset = null;
let currentKineticsFilename = null;
let currentKeepRecord = false;
let extractedFilenames = [];
const fitRanges = {}; // filename -> { start, end }
const kineticsTimeAxes = {}; // filename -> actual x values present on the kinetics chart
const datasetCache = {};
const integrationCache = {};
const fitResults = {};
const fitFigureUrls = { overlay: '', normalized: '' };
let runRecordSaveQueue = Promise.resolve();
let suppressKineticsRelayout = false;
const colorScales = {
    None: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
    viridis: ['#440154', '#3b528b', '#21908d', '#5dc863', '#fde725'],
    magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
    plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
    inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fdea45'],
    cividis: ['#00224e', '#434e6c', '#7d7c78', '#bcae6c', '#fee838'],
    Greys: ['#111111', '#444444', '#777777', '#aaaaaa', '#dddddd'],
    RdBu: ['#67001f', '#d6604d', '#f7f7f7', '#4393c3', '#053061'],
    RdBu_r: ['#053061', '#4393c3', '#f7f7f7', '#d6604d', '#67001f'],
    Spectral: ['#9e0142', '#f46d43', '#fdae61', '#abdda4', '#3288bd', '#5e4fa2'],
    coolwarm: ['#3b4cc0', '#8db0fe', '#f7f7f7', '#f4987a', '#b40426'],
};
const keepRecordCheckbox = document.getElementById('keepRecordCheckbox');
const waterfallGap = document.getElementById('waterfallGap');
const waterfallMaxLines = document.getElementById('waterfallMaxLines');
const fileRadioGroup = document.getElementById('fileRadioGroup');
const kineticsRadioGroup = document.getElementById('kineticsRadioGroup');
const vizStatusMsg = document.getElementById('vizStatusMsg');
const intStart = document.getElementById('intStart');
const intEnd = document.getElementById('intEnd');
const baselineMode = document.getElementById('baselineMode');
const integrateBtn = document.getElementById('integrateBtn');
const fittingSubsections = document.getElementById('fitting-subsections');
const fitColorScheme = document.getElementById('fitColorScheme');
const fitColorSchemePreview = document.getElementById('fitColorSchemePreview');
const overlayXAxisTitle = document.getElementById('overlayXAxisTitle');
const overlayYAxisTitle = document.getElementById('overlayYAxisTitle');
const overlayXRange = document.getElementById('overlayXRange');
const overlayYRange = document.getElementById('overlayYRange');
const overlayShowLabels = document.getElementById('overlayShowLabels');
const overlayLabelOffset = document.getElementById('overlayLabelOffset');
const normalizedXAxisTitle = document.getElementById('normalizedXAxisTitle');
const normalizedYAxisTitle = document.getElementById('normalizedYAxisTitle');
const normalizedXRange = document.getElementById('normalizedXRange');
const normalizedYRange = document.getElementById('normalizedYRange');
const normalizedShowLabels = document.getElementById('normalizedShowLabels');
const normalizedLabelOffset = document.getElementById('normalizedLabelOffset');
const runFitsBtn = document.getElementById('runFitsBtn');
const fitSummaryMsg = document.getElementById('fitSummaryMsg');
const fitStatusBadge = document.getElementById('fitStatusBadge');
const fitNormalizedMeta = document.getElementById('fitNormalizedMeta');
const fitResultCount = document.getElementById('fitResultCount');
const fitResultCards = document.getElementById('fitResultCards');
const fitOverlayImage = document.getElementById('fitOverlayImage');
const fitOverlayPlaceholder = document.getElementById('fitOverlayPlaceholder');
const fitNormalizedImage = document.getElementById('fitNormalizedImage');
const fitNormalizedPlaceholder = document.getElementById('fitNormalizedPlaceholder');

function sampleIndices(total, maxN) {
    if (total <= maxN) return Array.from({ length: total }, (_, i) => i);
    const step = Math.max(1, Math.floor(total / maxN));
    const idx = [];
    for (let i = 0; i < total; i += step) idx.push(i);
    if (idx[idx.length - 1] !== total - 1) idx.push(total - 1);
    return idx;
}

function getNearestTimeValue(filename, rawValue) {
    const axis = kineticsTimeAxes[filename];
    if (!Array.isArray(axis) || axis.length === 0 || !Number.isFinite(rawValue)) {
        return rawValue;
    }

    let nearest = axis[0];
    let bestDistance = Math.abs(rawValue - nearest);
    for (let i = 1; i < axis.length; i += 1) {
        const candidate = axis[i];
        const distance = Math.abs(rawValue - candidate);
        if (distance < bestDistance) {
            nearest = candidate;
            bestDistance = distance;
        }
    }
    return nearest;
}

function getSnappedFitRange(filename, startValue, endValue) {
    const snappedStart = getNearestTimeValue(filename, startValue);
    const snappedEnd = getNearestTimeValue(filename, endValue);
    return {
        start: Math.min(snappedStart, snappedEnd),
        end: Math.max(snappedStart, snappedEnd),
    };
}

function clearObject(obj) {
    Object.keys(obj).forEach((key) => {
        delete obj[key];
    });
}

function hexToRgb(hex) {
    const value = String(hex || '').replace('#', '').trim();
    const normalized = value.length === 3
        ? value.split('').map((char) => char + char).join('')
        : value;
    const intValue = Number.parseInt(normalized, 16);
    if (!Number.isFinite(intValue)) {
        return { r: 0, g: 0, b: 0 };
    }
    return {
        r: (intValue >> 16) & 255,
        g: (intValue >> 8) & 255,
        b: intValue & 255,
    };
}

function rgbToHex({ r, g, b }) {
    const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function interpolateColor(startHex, endHex, t) {
    const start = hexToRgb(startHex);
    const end = hexToRgb(endHex);
    return rgbToHex({
        r: start.r + (end.r - start.r) * t,
        g: start.g + (end.g - start.g) * t,
        b: start.b + (end.b - start.b) * t,
    });
}

function sampleColors(scaleName, count) {
    const anchors = colorScales[scaleName] || colorScales.None;
    if (count <= 1) return [anchors[0]];
    if (scaleName === 'None') return anchors.slice(0, count);

    const output = [];
    const segments = anchors.length - 1;
    for (let i = 0; i < count; i += 1) {
        const pos = (i / Math.max(1, count - 1)) * segments;
        const left = Math.min(segments - 1, Math.floor(pos));
        const localT = pos - left;
        output.push(interpolateColor(anchors[left], anchors[left + 1], localT));
    }
    return output;
}

function updateColorSchemePreview() {
    if (!fitColorSchemePreview) return;
    const previewColors = sampleColors(fitColorScheme?.value || 'None', 8);
    fitColorSchemePreview.innerHTML = previewColors.map((color) => `
        <span style="flex: 1 1 0; height: 14px; border-radius: 999px; background: ${color}; border: 1px solid rgba(255,255,255,0.16);"></span>
    `).join('');
}

function getCurrentPalette() {
    return sampleColors(fitColorScheme?.value || 'None', Math.max(extractedFilenames.length, 10));
}

function getFileColor(filename) {
    const idx = Math.max(0, extractedFilenames.indexOf(filename));
    const palette = getCurrentPalette();
    return palette[idx % palette.length];
}

function getDisplayName(filename) {
    return String(filename).replace(/\.srs$/i, '');
}

function formatNumber(value, digits = 4) {
    if (!Number.isFinite(value)) return 'n/a';
    return Number(value).toFixed(digits);
}

function isKeepRecordEnabled() {
    return Boolean(keepRecordCheckbox?.checked);
}

function parseRangeInput(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parts = text.split(',').map((item) => Number(item.trim()));
    if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item))) return null;
    return parts[0] <= parts[1] ? parts : [parts[1], parts[0]];
}

function parseOffsetInput(value) {
    const text = String(value || '').trim();
    if (!text) return [0, 0];
    const parts = text.split(',').map((item) => Number(item.trim()));
    if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item))) return [0, 0];
    return parts;
}

function buildFigureRenderSettings() {
    return {
        color_scheme: fitColorScheme.value,
        overlay: {
            xlabel: overlayXAxisTitle.value.trim() || 'Time / Potential',
            ylabel: overlayYAxisTitle.value.trim() || 'Peak Area',
            xlim: parseRangeInput(overlayXRange.value),
            ylim: parseRangeInput(overlayYRange.value),
            show_labels: overlayShowLabels.checked,
            label_offset: parseOffsetInput(overlayLabelOffset.value),
        },
        normalized: {
            xlabel: normalizedXAxisTitle.value.trim() || 'Time / Potential',
            ylabel: normalizedYAxisTitle.value.trim() || 'Normalized Peak Area',
            xlim: parseRangeInput(normalizedXRange.value),
            ylim: parseRangeInput(normalizedYRange.value),
            show_labels: normalizedShowLabels.checked,
            label_offset: parseOffsetInput(normalizedLabelOffset.value),
        },
    };
}

function buildRunRecordSnapshot() {
    const fitSummary = {};
    extractedFilenames.forEach((filename) => {
        const result = fitResults[filename];
        if (!result) {
            fitSummary[filename] = null;
            return;
        }
        if (result.error) {
            fitSummary[filename] = { error: result.error };
            return;
        }
        fitSummary[filename] = {
            fit_range: result.fit_range,
            points_used: result.points_used,
            params: result.params,
            metrics: result.metrics,
            ci95: result.ci95,
            integration_window: result.integration_window,
        };
    });

    return {
        updated_at: new Date().toISOString(),
        keep_record: isKeepRecordEnabled(),
        source_folder: currentFolderPath,
        selected_files: [...selectedFiles],
        extracted_files: [...extractedFilenames],
        settings: {
            extraction: {
                mode: document.getElementById('mode').value,
                start_wn: Number(document.getElementById('defaultStart').value),
                end_wn: Number(document.getElementById('defaultEnd').value),
            },
            integration: {
                start_wn: Number(intStart.value),
                end_wn: Number(intEnd.value),
                baseline_mode: baselineMode.value,
            },
            waterfall: {
                gap: Number(waterfallGap.value),
                max_lines: Number(waterfallMaxLines.value),
            },
            figure_render: buildFigureRenderSettings(),
            fit_ranges: Object.fromEntries(
                extractedFilenames
                    .filter((filename) => fitRanges[filename])
                    .map((filename) => [filename, fitRanges[filename]])
            ),
        },
        active_views: {
            spectra_filename: currentDataset?.filename || null,
            kinetics_filename: currentKineticsFilename,
        },
        artifacts: {
            overlay_image: fitFigureUrls.overlay ? 'fit_overlay.png' : null,
            normalized_image: fitFigureUrls.normalized ? 'fit_normalized.png' : null,
        },
        fit_results: fitSummary,
    };
}

function queueRunRecordSave() {
    if (!currentRunId) return Promise.resolve();

    const payload = {
        run_id: currentRunId,
        keep_record: isKeepRecordEnabled(),
        record: buildRunRecordSnapshot(),
    };

    runRecordSaveQueue = runRecordSaveQueue
        .catch(() => {})
        .then(async () => {
            try {
                await fetch('/api/save_run_record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } catch (error) {
                console.warn('Run record save error:', error.message);
            }
        });

    return runRecordSaveQueue;
}

function setFitImage(imgEl, placeholderEl, src, message) {
    if (src) {
        imgEl.src = src;
        imgEl.style.display = 'block';
        placeholderEl.style.display = 'none';
        return;
    }
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
    placeholderEl.textContent = message;
    placeholderEl.style.display = 'flex';
}

function clearFitImages(message = 'Run fitting to generate result images.') {
    fitFigureUrls.overlay = '';
    fitFigureUrls.normalized = '';
    setFitImage(fitOverlayImage, fitOverlayPlaceholder, '', message);
    setFitImage(fitNormalizedImage, fitNormalizedPlaceholder, '', message);
}

function buildSuccessfulSeriesPayload() {
    return extractedFilenames
        .filter((filename) => fitResults[filename] && !fitResults[filename].error)
        .map((filename) => {
            const result = fitResults[filename];
            return {
                label: getDisplayName(filename),
                color: getFileColor(filename),
                full_time: result.full_time,
                full_areas: result.full_areas,
                x_fit: result.x_sorted,
                y_fit: result.y_fit,
                x_raw: result.x_selected,
                y_raw: result.y_selected_norm,
                y_fit_norm: result.y_fit_norm,
            };
        });
}

async function renderFitFiguresFromCurrentResults(statusMessage = 'Refreshing fit figures…') {
    if (!currentRunId) return '';
    const successfulSeriesPayload = buildSuccessfulSeriesPayload();
    if (successfulSeriesPayload.length === 0) {
        fitFigureUrls.overlay = '';
        fitFigureUrls.normalized = '';
        return '';
    }

    fitSummaryMsg.textContent = statusMessage;

    try {
        const figureResp = await fetch('/api/render-fit-figures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                run_id: currentRunId,
                series: successfulSeriesPayload,
                figure_settings: buildFigureRenderSettings(),
            }),
        });
        const figureBody = await figureResp.json();
        if (!figureResp.ok) throw new Error(figureBody.detail || 'Failed to render fit figures');
        fitFigureUrls.overlay = figureBody.overlay_url;
        fitFigureUrls.normalized = figureBody.normalized_url;
        return '';
    } catch (error) {
        fitFigureUrls.overlay = '';
        fitFigureUrls.normalized = '';
        return error.message || 'Unknown render error';
    }
}

function renderFitOutputs() {
    const successfulFits = extractedFilenames.filter((filename) => fitResults[filename] && !fitResults[filename].error);
    const failedFits = extractedFilenames.filter((filename) => fitResults[filename]?.error);
    const attemptedFits = successfulFits.length + failedFits.length;

    if (successfulFits.length === 0) {
        clearFitImages(attemptedFits === 0 ? 'Run fitting to generate result images.' : 'No successful fit image available.');
        fitResultCards.innerHTML = attemptedFits === 0
            ? '<div class="result-empty">Run fitting to populate parameter cards.</div>'
            : extractedFilenames.map((filename) => {
                const result = fitResults[filename];
                const color = getFileColor(filename);
                if (!result?.error) return '';
                return `
                    <div class="result-item" style="padding: 14px 16px; border-left: 4px solid ${color};">
                        <div class="result-item-name">${filename}</div>
                        <div class="result-item-meta" style="color: #ffb4c1; margin-top: 6px;">${result.error}</div>
                    </div>
                `;
            }).join('');
        fitResultCount.textContent = attemptedFits === 0 ? '0 files' : `${failedFits.length} failed`;
        fitStatusBadge.textContent = attemptedFits === 0
            ? (extractedFilenames.length ? 'Awaiting fit' : 'Not fitted')
            : `Failed (${failedFits.length})`;
        fitNormalizedMeta.textContent = attemptedFits === 0 ? 'No fit data' : 'No successful fit';
        return;
    }

    setFitImage(
        fitOverlayImage,
        fitOverlayPlaceholder,
        fitFigureUrls.overlay,
        'Overlay image is not available.',
    );
    setFitImage(
        fitNormalizedImage,
        fitNormalizedPlaceholder,
        fitFigureUrls.normalized,
        'Normalized image is not available.',
    );

    fitResultCards.innerHTML = extractedFilenames.map((filename) => {
        const result = fitResults[filename];
        const color = getFileColor(filename);
        if (!result) {
            return `
                <div class="result-item" style="padding: 14px 16px; border-left: 4px solid ${color};">
                    <div class="result-item-name">${filename}</div>
                    <div class="result-item-meta">No fit executed yet.</div>
                </div>
            `;
        }
        if (result.error) {
            return `
                <div class="result-item" style="padding: 14px 16px; border-left: 4px solid ${color};">
                    <div class="result-item-name">${filename}</div>
                    <div class="result-item-meta" style="color: #ffb4c1;">${result.error}</div>
                </div>
            `;
        }
        return `
            <div class="result-item" style="padding: 14px 16px; border-left: 4px solid ${color};">
                <div class="result-item-name">${filename}</div>
                <div class="result-item-meta" style="margin-top: 6px;">Range: ${formatNumber(result.fit_range[0], 4)} → ${formatNumber(result.fit_range[1], 4)} | Points: ${result.points_used}</div>
                <div class="result-item-meta" style="margin-top: 4px;">Yb=${formatNumber(result.params.Yb)} | A=${formatNumber(result.params.A)} | TD=${formatNumber(result.params.TD)} | Tau=${formatNumber(result.params.Tau)}</div>
                <div class="result-item-meta" style="margin-top: 4px;">R²=${formatNumber(result.metrics.r2)} | RMSE=${formatNumber(result.metrics.rmse, 6)}</div>
            </div>
        `;
    }).join('');

    fitResultCount.textContent = `${successfulFits.length} fitted`;
    fitStatusBadge.textContent = failedFits.length ? `Partial (${successfulFits.length}/${extractedFilenames.length})` : `Ready (${successfulFits.length})`;
    fitNormalizedMeta.textContent = `${successfulFits.length} normalized segment(s)`;
}

function invalidateFitResultsOnly(message = 'Fit ranges changed. Run fitting again to refresh the right-hand results.') {
    clearObject(fitResults);
    clearFitImages(message);
    fitSummaryMsg.textContent = message;
    renderFitOutputs();
    queueRunRecordSave();
}

function invalidateDerivedState() {
    clearObject(integrationCache);
    invalidateFitResultsOnly('Integration settings changed. Run fitting again to refresh the right-hand results.');
}

async function refreshFitFiguresForStyleChange() {
    renderFitOutputs();
    queueRunRecordSave();

    if (!buildSuccessfulSeriesPayload().length) return;

    const figureRenderError = await renderFitFiguresFromCurrentResults('Refreshing fit figures…');
    renderFitOutputs();
    fitSummaryMsg.textContent = figureRenderError
        ? `Figure refresh failed: ${figureRenderError}`
        : 'Updated figure settings applied to the right-hand images.';
}

async function fetchDataset(filename) {
    if (datasetCache[filename]) return datasetCache[filename];
    const resp = await fetch('/api/get_dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: currentRunId, filename }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.detail || 'Failed to load dataset');
    datasetCache[filename] = body;
    return body;
}

async function integrateDatasetForFile(filename) {
    if (integrationCache[filename]) return integrationCache[filename];
    const ds = await fetchDataset(filename);
    const resp = await fetch('/api/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            wavenumbers: ds.wavenumbers,
            time: ds.time,
            spectra: ds.spectra,
            start: Number(intStart.value),
            end: Number(intEnd.value),
            baseline_mode: baselineMode.value,
        }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.detail || 'Integration failed');
    integrationCache[filename] = { ...body, filename };
    kineticsTimeAxes[filename] = Array.from(new Set(body.time.slice().sort((a, b) => a - b)));
    return integrationCache[filename];
}

function getSelectedFitPoints(integrationBody, filename) {
    if (!integrationBody) return null;
    const defaultRange = {
        start: Math.min(...integrationBody.time),
        end: Math.max(...integrationBody.time),
    };
    fitRanges[filename] = fitRanges[filename]
        ? getSnappedFitRange(filename, fitRanges[filename].start, fitRanges[filename].end)
        : defaultRange;
    syncFitInputs(filename);

    const xSel = [];
    const ySel = [];
    for (let i = 0; i < integrationBody.time.length; i += 1) {
        const t = integrationBody.time[i];
        if (t >= fitRanges[filename].start && t <= fitRanges[filename].end) {
            xSel.push(t);
            ySel.push(integrationBody.areas[i]);
        }
    }

    return {
        fit_range: [fitRanges[filename].start, fitRanges[filename].end],
        x_selected: xSel,
        y_selected: ySel,
    };
}

function normalizeSeriesPair(yRaw, yFit) {
    const combined = [...yRaw, ...yFit].filter((value) => Number.isFinite(value));
    if (combined.length === 0) {
        return { raw: yRaw.map(() => 0), fit: yFit.map(() => 0) };
    }
    const minValue = Math.min(...combined);
    const maxValue = Math.max(...combined);
    const span = maxValue - minValue;
    if (span < 1e-12) {
        return { raw: yRaw.map(() => 0), fit: yFit.map(() => 0) };
    }
    return {
        raw: yRaw.map((value) => (value - minValue) / span),
        fit: yFit.map((value) => (value - minValue) / span),
    };
}

function renderSpectra(data) {
    const totalFrames = data.spectra.length;
    const order = Array.from({ length: totalFrames }, (_, i) => i).sort((a, b) => data.time[a] - data.time[b]);
    const maxN = Math.max(1, Math.min(Number(waterfallMaxLines.value) || 15, totalFrames));
    const frameIdx = sampleIndices(order.length, maxN).map(k => order[k]);
    const gap = Number(waterfallGap.value) || 0;
    const traces = frameIdx.map((i, stackIdx) => ({
        x: data.wavenumbers,
        y: data.spectra[i].map(v => v + stackIdx * gap),
        mode: 'lines',
        line: { width: 1.1 },
        name: `t=${data.time[i].toFixed(4)}`,
    }));

    const s0 = Number(intStart.value) || 0;
    const s1 = Number(intEnd.value) || 0;

    Plotly.newPlot(
        'spectraPlot',
        traces,
        {
            title: { text: `SRS Waterfall — ${data.filename} (Gap=${gap.toPrecision(4)})`, font: { color: '#eeeeee' } },
            xaxis: { title: 'Wavenumber (cm⁻¹)', gridcolor: '#333', zerolinecolor: '#444', tickfont: { color: '#ccc' }, titlefont: { color: '#ccc' } },
            yaxis: { title: 'Intensity + Offset', gridcolor: '#333', zerolinecolor: '#444', tickfont: { color: '#ccc' }, titlefont: { color: '#ccc' } },
            margin: { l: 60, r: 20, t: 52, b: 50 },
            plot_bgcolor: 'transparent',
            paper_bgcolor: 'transparent',
            showlegend: false,
            dragmode: false,
            shapes: [
                { type: 'line', x0: s0, x1: s0, y0: 0, y1: 1, yref: 'paper', line: { color: '#dd6b20', width: 2, dash: 'dot' }, editable: true },
                { type: 'line', x0: s1, x1: s1, y0: 0, y1: 1, yref: 'paper', line: { color: '#dd6b20', width: 2, dash: 'dot' }, editable: true },
            ],
        },
        {
            responsive: true,
            editable: true,
            edits: { shapePosition: true, annotationPosition: false, annotationTail: false, annotationText: false, axisTitleText: false, colorbarPosition: false, colorbarTitleText: false, legendPosition: false, legendText: false, shapeText: false, titleText: false },
            displaylogo: false,
            scrollZoom: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
        }
    ).then(() => {
        const plotDiv = document.getElementById('spectraPlot');
        plotDiv.on('plotly_relayout', (eventData) => {
            let changed = false;
            let newStart = Number(intStart.value);
            let newEnd = Number(intEnd.value);
            if (eventData['shapes[0].x0'] !== undefined) { newStart = Number(eventData['shapes[0].x0']); changed = true; }
            else if (eventData['shapes[0].x1'] !== undefined) { newStart = Number(eventData['shapes[0].x1']); changed = true; }
            if (eventData['shapes[1].x0'] !== undefined) { newEnd = Number(eventData['shapes[1].x0']); changed = true; }
            else if (eventData['shapes[1].x1'] !== undefined) { newEnd = Number(eventData['shapes[1].x1']); changed = true; }
            if (changed) {
                intStart.value = Math.min(newStart, newEnd).toFixed(2);
                intEnd.value = Math.max(newStart, newEnd).toFixed(2);
                invalidateDerivedState();
                // Debounce-trigger integration update
                clearTimeout(window._integDebounce);
                window._integDebounce = setTimeout(() => updateIntegration(), 300);
            }
        });
    });
}

async function loadAndRenderFile(filename) {
    if (!currentRunId) return;
    vizStatusMsg.textContent = `Loading ${filename}\u2026`;
    try {
        const body = await fetchDataset(filename);

        currentDataset = body;

        // Auto-set gap only on first load
        if (Number(waterfallGap.value) === 0) {
            let minV = Infinity, maxV = -Infinity;
            for (const row of body.spectra) {
                for (const v of row) {
                    if (v < minV) minV = v;
                    if (v > maxV) maxV = v;
                }
            }
            waterfallGap.value = String(((maxV - minV) * 0.05).toPrecision(4));
        }

        // DO NOT reset intStart/intEnd when switching files — keep user's window
        renderSpectra(body);
        vizStatusMsg.textContent = `Showing: ${filename}`;
    } catch (e) {
        vizStatusMsg.textContent = `Error loading ${filename}: ${e.message}`;
    }
}

function renderKineticsPlot(intData, filename) {
    kineticsTimeAxes[filename] = Array.isArray(intData.time) ? [...intData.time] : [];
    const fr = fitRanges[filename] || {};
    const tMin = Math.min(...intData.time);
    const tMax = Math.max(...intData.time);
    const snappedRange = getSnappedFitRange(
        filename,
        fr.start !== undefined ? fr.start : tMin,
        fr.end !== undefined ? fr.end : tMax,
    );
    const t0 = snappedRange.start;
    const t1 = snappedRange.end;

    // Seed fitRanges if first time seeing this file
    if (fitRanges[filename] === undefined) {
        fitRanges[filename] = { start: t0, end: t1 };
    } else {
        fitRanges[filename] = snappedRange;
    }
    syncFitInputs(filename);

    Plotly.newPlot(
        'kineticsPlot',
        [{
            x: intData.time,
            y: intData.areas,
            mode: 'lines+markers',
            marker: { size: 5, color: '#3dc19e' },
            line: { color: '#3dc19e' },
            name: 'Integrated Area',
        }],
        {
            title: { text: `Area\u2013Time [${intData.window[0].toFixed(0)}, ${intData.window[1].toFixed(0)}] cm\u207b\u00b9  \u2014  ${filename}`, font: { color: '#eeeeee', size: 12 } },
            xaxis: { title: 'Time / Potential', gridcolor: '#333', zerolinecolor: '#444', tickfont: { color: '#ccc' }, titlefont: { color: '#ccc' } },
            yaxis: { title: 'Integrated Area', gridcolor: '#333', zerolinecolor: '#444', tickfont: { color: '#ccc' }, titlefont: { color: '#ccc' } },
            margin: { l: 60, r: 20, t: 52, b: 50 },
            plot_bgcolor: 'transparent',
            paper_bgcolor: 'transparent',
            shapes: [
                { type: 'line', x0: t0, x1: t0, y0: 0, y1: 1, yref: 'paper', line: { color: '#a855f7', width: 2, dash: 'dot' }, editable: true },
                { type: 'line', x0: t1, x1: t1, y0: 0, y1: 1, yref: 'paper', line: { color: '#a855f7', width: 2, dash: 'dot' }, editable: true },
            ],
        },
        {
            responsive: true, displaylogo: false, scrollZoom: false,
            editable: true,
            edits: { shapePosition: true, annotationPosition: false, annotationTail: false, annotationText: false, axisTitleText: false, colorbarPosition: false, colorbarTitleText: false, legendPosition: false, legendText: false, shapeText: false, titleText: false },
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
        }
    ).then(() => {
        const plotDiv = document.getElementById('kineticsPlot');
        if (plotDiv.removeAllListeners) plotDiv.removeAllListeners('plotly_relayout');
        plotDiv.on('plotly_relayout', (ev) => {
            if (suppressKineticsRelayout) {
                suppressKineticsRelayout = false;
                return;
            }

            let newT0 = fitRanges[filename]?.start ?? tMin;
            let newT1 = fitRanges[filename]?.end ?? tMax;
            let changed = false;
            if (ev['shapes[0].x0'] !== undefined) { newT0 = Number(ev['shapes[0].x0']); changed = true; }
            else if (ev['shapes[0].x1'] !== undefined) { newT0 = Number(ev['shapes[0].x1']); changed = true; }
            if (ev['shapes[1].x0'] !== undefined) { newT1 = Number(ev['shapes[1].x0']); changed = true; }
            else if (ev['shapes[1].x1'] !== undefined) { newT1 = Number(ev['shapes[1].x1']); changed = true; }
            if (changed) {
                const snapped = getSnappedFitRange(filename, newT0, newT1);
                fitRanges[filename] = snapped;
                syncFitInputs(filename);
                invalidateFitResultsOnly();
                suppressKineticsRelayout = true;
                Plotly.relayout('kineticsPlot', {
                    'shapes[0].x0': snapped.start,
                    'shapes[0].x1': snapped.start,
                    'shapes[1].x0': snapped.end,
                    'shapes[1].x1': snapped.end,
                }).catch(() => {
                    suppressKineticsRelayout = false;
                });
            }
        });
    });
}

/** Push fitRanges[filename] values to the sidebar inputs for that file. */
function syncFitInputs(filename) {
    const fr = fitRanges[filename];
    if (!fr) return;
    const key = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const startEl = document.getElementById(`fitStart_${key}`);
    const endEl = document.getElementById(`fitEnd_${key}`);
    if (startEl) startEl.value = fr.start.toFixed(4);
    if (endEl) endEl.value = fr.end.toFixed(4);
}


async function updateIntegration() {
    const filename = currentKineticsFilename || currentDataset?.filename;
    if (!filename) return;
    try {
        const body = await integrateDatasetForFile(filename);
        renderKineticsPlot(body, filename);
    } catch (e) {
        console.warn('Integration error:', e.message);
    }
}

function buildFileRadioGroup(succeededFiles) {
    fileRadioGroup.innerHTML = '';
    fileRadioGroup.style.display = 'flex';

    succeededFiles.forEach((filename, idx) => {
        const label = document.createElement('label');
        label.title = filename;
        label.style.cssText = [
            'cursor: pointer',
            'display: inline-flex',
            'align-items: center',
            'gap: 5px',
            'padding: 3px 8px',
            'border-radius: 999px',
            'border: 1px solid var(--border-subtle)',
            'font-size: 0.72rem',
            'color: var(--text-secondary)',
            'white-space: nowrap',
            'transition: background 0.15s, color 0.15s',
        ].join(';');

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'fileRadio';
        radio.value = filename;
        radio.style.cssText = 'margin: 0; cursor: pointer; width: 11px; height: 11px;';
        if (idx === 0) radio.checked = true;

        const span = document.createElement('span');
        // Abbreviate to last part of filename for compactness
        span.textContent = filename.length > 30 ? '…' + filename.slice(-27) : filename;

        radio.addEventListener('change', () => {
            if (radio.checked) {
                // Highlight selected pill
                fileRadioGroup.querySelectorAll('label').forEach(l => {
                    l.style.background = '';
                    l.style.color = 'var(--text-secondary)';
                });
                label.style.background = 'var(--accent, #3dc19e22)';
                label.style.color = 'var(--text-primary)';
                loadAndRenderFile(filename);
            }
        });

        label.appendChild(radio);
        label.appendChild(span);
        fileRadioGroup.appendChild(label);

        // Highlight first one by default
        if (idx === 0) {
            label.style.background = 'var(--accent, #3dc19e22)';
            label.style.color = 'var(--text-primary)';
        }
    });
}

// ── Extract All button ────────────────────────────────────────────────────────
extractAllBtn.addEventListener('click', async () => {
    if (!currentFolderPath || selectedFiles.length === 0) return;

    const previousRunId = currentRunId;
    const previousKeepRecord = currentKeepRecord;
    extractAllBtn.disabled = true;
    vizStatusMsg.textContent = `Extracting ${selectedFiles.length} file(s)…`;
    waterfallGap.value = '0';

    try {
        const resp = await fetch('/api/extract_all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder_path: currentFolderPath,
                files: selectedFiles,
                mode: document.getElementById('mode').value,
                start: Number(document.getElementById('defaultStart').value),
                end: Number(document.getElementById('defaultEnd').value),
                keep_record: isKeepRecordEnabled(),
            }),
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.detail || 'Extraction failed');

        if (previousRunId && !previousKeepRecord) {
            fetch('/api/cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ run_id: previousRunId }),
            }).catch(() => {});
        }

        currentRunId = body.run_id;
        currentKeepRecord = Boolean(body.keep_record);
        keepRecordCheckbox.checked = currentKeepRecord;

        if (body.failed && Object.keys(body.failed).length > 0) {
            console.warn('Some files failed:', body.failed);
        }

        extractedFilenames = [...body.succeeded];
        clearObject(datasetCache);
        clearObject(integrationCache);
        clearObject(fitRanges);
        clearObject(kineticsTimeAxes);
        clearObject(fitResults);
        currentDataset = null;
        currentKineticsDataset = null;
        currentKineticsFilename = null;
        runFitsBtn.disabled = body.succeeded.length === 0;
        fitSummaryMsg.textContent = 'Set fit ranges in Step 3, then run fitting for all selected files.';
        renderFitOutputs();

        buildFileRadioGroup(body.succeeded);
        buildKineticsRadioGroup(body.succeeded);
        buildFittingSubsections(body.succeeded);
        integrateBtn.disabled = false;

        // Seed integration window from extraction defaults (once, on first extraction)
        intStart.value = document.getElementById('defaultStart').value;
        intEnd.value = document.getElementById('defaultEnd').value;

        // Load first file into both waterfall and kinetics
        await loadAndRenderFile(body.succeeded[0]);
        await loadKineticsDataset(body.succeeded[0]);
        await queueRunRecordSave();

        vizStatusMsg.textContent = `Extracted ${body.succeeded.length} file(s). Select a file above to view its waterfall.`;
    } catch (e) {
        vizStatusMsg.textContent = `Extraction error: ${e.message}`;
    } finally {
        extractAllBtn.disabled = false;
    }
});

waterfallGap.addEventListener('change', () => {
    const checked = fileRadioGroup.querySelector('input[name="fileRadio"]:checked');
    if (checked) loadAndRenderFile(checked.value);
    queueRunRecordSave();
});

waterfallMaxLines.addEventListener('change', () => {
    const checked = fileRadioGroup.querySelector('input[name="fileRadio"]:checked');
    if (checked) loadAndRenderFile(checked.value);
    queueRunRecordSave();
});

// Integrate button: manual trigger
integrateBtn.addEventListener('click', async () => {
    invalidateDerivedState();
    if (currentDataset) renderSpectra(currentDataset);
    await updateIntegration();
});

// When user manually edits intStart/intEnd, sync lines + re-integrate
[intStart, intEnd].forEach(el => {
    el.addEventListener('change', () => {
        invalidateDerivedState();
        if (currentDataset) renderSpectra(currentDataset);
        updateIntegration();
    });
});

baselineMode.addEventListener('change', () => {
    invalidateDerivedState();
    updateIntegration();
});

/** Load a dataset for the kinetics panel only (does not touch the waterfall). */
async function loadKineticsDataset(filename) {
    if (!currentRunId) return;
    currentKineticsFilename = filename;
    try {
        const body = await fetchDataset(filename);
        currentKineticsDataset = body;
        await updateIntegration();
    } catch (e) {
        console.warn('Kinetics dataset load error:', e.message);
    }
}

function buildKineticsRadioGroup(succeededFiles) {
    kineticsRadioGroup.innerHTML = '';
    kineticsRadioGroup.style.display = 'flex';

    succeededFiles.forEach((filename, idx) => {
        const label = document.createElement('label');
        label.title = filename;
        label.style.cssText = [
            'cursor: pointer', 'display: inline-flex', 'align-items: center',
            'gap: 5px', 'padding: 3px 8px', 'border-radius: 999px',
            'border: 1px solid var(--border-subtle)', 'font-size: 0.72rem',
            'color: var(--text-secondary)', 'white-space: nowrap',
            'transition: background 0.15s, color 0.15s',
        ].join(';');

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'kineticsRadio';
        radio.value = filename;
        radio.style.cssText = 'margin: 0; cursor: pointer; width: 11px; height: 11px;';
        if (idx === 0) radio.checked = true;

        const span = document.createElement('span');
        span.textContent = filename.length > 30 ? '\u2026' + filename.slice(-27) : filename;

        radio.addEventListener('change', () => {
            if (radio.checked) {
                selectKineticsFile(filename);
            }
        });

        label.appendChild(radio);
        label.appendChild(span);
        kineticsRadioGroup.appendChild(label);

        if (idx === 0) {
            label.style.background = 'var(--accent, #3dc19e22)';
            label.style.color = 'var(--text-primary)';
        }
    });
}

async function selectKineticsFile(filename) {
    let targetRadio = null;

    kineticsRadioGroup.querySelectorAll('input[name="kineticsRadio"]').forEach((radio) => {
        const isMatch = radio.value === filename;
        radio.checked = isMatch;
        if (isMatch) targetRadio = radio;
    });

    kineticsRadioGroup.querySelectorAll('label').forEach((label) => {
        const radio = label.querySelector('input[name="kineticsRadio"]');
        if (radio && radio.value === filename) {
            label.style.background = 'var(--accent, #3dc19e22)';
            label.style.color = 'var(--text-primary)';
        } else {
            label.style.background = '';
            label.style.color = 'var(--text-secondary)';
        }
    });

    if (!targetRadio) return;
    if (currentKineticsFilename === filename && currentKineticsDataset) return;
    await loadKineticsDataset(filename);
}

function buildFittingSubsections(succeededFiles) {
    fittingSubsections.innerHTML = '';

    succeededFiles.forEach((filename) => {
        const key = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
        const wrapper = document.createElement('section');
        wrapper.className = 'fitting-subsection';
        wrapper.style.cssText = [
            'border: 1px solid var(--border-subtle)',
            'border-radius: 10px',
            'margin-bottom: 10px',
            'background: rgba(255,255,255,0.02)',
            'overflow: hidden',
        ].join(';');

        const header = document.createElement('button');
        header.type = 'button';
        header.setAttribute('aria-expanded', 'false');
        header.style.cssText = [
            'width: 100%',
            'display: flex',
            'align-items: center',
            'justify-content: space-between',
            'gap: 10px',
            'padding: 10px 12px',
            'background: transparent',
            'border: 0',
            'color: var(--text-primary)',
            'cursor: pointer',
            'font: inherit',
        ].join(';');

        const title = document.createElement('span');
        title.textContent = filename;
        title.style.cssText = [
            'font-size: 0.82rem',
            'font-weight: 600',
            'overflow: hidden',
            'text-overflow: ellipsis',
            'white-space: nowrap',
            'text-align: left',
        ].join(';');

        const arrow = document.createElement('span');
        arrow.textContent = '▶';
        arrow.style.cssText = 'font-size: 0.75rem; color: var(--text-secondary); flex: 0 0 auto;';

        header.appendChild(title);
        header.appendChild(arrow);

        const content = document.createElement('div');
        content.style.cssText = 'display: none; padding: 0 12px 12px;';

        const startGroup = document.createElement('div');
        startGroup.className = 'form-group';
        startGroup.style.marginBottom = '12px';

        const startLabel = document.createElement('label');
        startLabel.setAttribute('for', `fitStart_${key}`);
        startLabel.textContent = 'Fit Start Time';

        const startInput = document.createElement('input');
        startInput.id = `fitStart_${key}`;
        startInput.type = 'number';
        startInput.step = 'any';
        startInput.className = 'field-control';
        startInput.placeholder = 'Load this file to seed range';

        startGroup.appendChild(startLabel);
        startGroup.appendChild(startInput);

        const endGroup = document.createElement('div');
        endGroup.className = 'form-group';
        endGroup.style.marginBottom = '0';

        const endLabel = document.createElement('label');
        endLabel.setAttribute('for', `fitEnd_${key}`);
        endLabel.textContent = 'Fit End Time';

        const endInput = document.createElement('input');
        endInput.id = `fitEnd_${key}`;
        endInput.type = 'number';
        endInput.step = 'any';
        endInput.className = 'field-control';
        endInput.placeholder = 'Load this file to seed range';

        endGroup.appendChild(endLabel);
        endGroup.appendChild(endInput);

        const applyFitRange = async () => {
            const startVal = Number(startInput.value);
            const endVal = Number(endInput.value);
            if (!Number.isFinite(startVal) || !Number.isFinite(endVal)) return;

            if (!kineticsTimeAxes[filename]?.length) {
                await selectKineticsFile(filename);
            }

            fitRanges[filename] = getSnappedFitRange(filename, startVal, endVal);
            syncFitInputs(filename);
            invalidateFitResultsOnly();

            if (currentKineticsFilename === filename) {
                suppressKineticsRelayout = true;
                Plotly.relayout('kineticsPlot', {
                    'shapes[0].x0': fitRanges[filename].start,
                    'shapes[0].x1': fitRanges[filename].start,
                    'shapes[1].x0': fitRanges[filename].end,
                    'shapes[1].x1': fitRanges[filename].end,
                }).catch(() => {
                    suppressKineticsRelayout = false;
                });
            } else {
                await selectKineticsFile(filename);
            }
        };

        [startInput, endInput].forEach((input) => {
            input.addEventListener('change', applyFitRange);
        });

        header.addEventListener('click', () => {
            const isExpanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
            content.style.display = isExpanded ? 'none' : 'block';
            arrow.textContent = isExpanded ? '▶' : '▼';
            if (!isExpanded) {
                selectKineticsFile(filename);
            }
        });

        content.appendChild(startGroup);
        content.appendChild(endGroup);
        wrapper.appendChild(header);
        wrapper.appendChild(content);
        fittingSubsections.appendChild(wrapper);

        syncFitInputs(filename);
    });
}

runFitsBtn.addEventListener('click', async () => {
    if (!currentRunId || extractedFilenames.length === 0) return;

    runFitsBtn.disabled = true;
    fitSummaryMsg.textContent = `Running fits for ${extractedFilenames.length} file(s)…`;
    fitStatusBadge.textContent = 'Running';
    fitNormalizedMeta.textContent = 'Preparing data';
    clearObject(fitResults);
    renderFitOutputs();

    let successCount = 0;
    let failureCount = 0;

    for (const filename of extractedFilenames) {
        try {
            const integrationBody = await integrateDatasetForFile(filename);
            const selected = getSelectedFitPoints(integrationBody, filename);

            if (!selected || selected.x_selected.length < 4) {
                fitResults[filename] = {
                    error: 'Not enough points inside the fit range (need at least 4).',
                };
                failureCount += 1;
                continue;
            }

            const resp = await fetch('/api/fit-kinetics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    x: selected.x_selected,
                    y: selected.y_selected,
                }),
            });
            const body = await resp.json();
            if (!resp.ok) throw new Error(body.detail || 'fit failed');

            const normalized = normalizeSeriesPair(selected.y_selected, body.y_fit);
            fitResults[filename] = {
                ...body,
                filename,
                fit_range: selected.fit_range,
                points_used: selected.x_selected.length,
                x_selected: selected.x_selected,
                y_selected: selected.y_selected,
                y_selected_norm: normalized.raw,
                y_fit_norm: normalized.fit,
                full_time: integrationBody.time,
                full_areas: integrationBody.areas,
                integration_window: integrationBody.window,
            };
            successCount += 1;
        } catch (error) {
            fitResults[filename] = {
                error: error.message || 'Unknown fit error',
            };
            failureCount += 1;
        }
    }

    const figureRenderError = await renderFitFiguresFromCurrentResults(`Rendering fit figures for ${successCount} file(s)…`);

    fitSummaryMsg.textContent = figureRenderError
        ? `Fits completed, but figure rendering failed: ${figureRenderError}`
        : failureCount === 0
            ? `Completed fits for ${successCount} file(s). Overlay and normalized comparison are shown on the right.`
            : `Completed fits for ${successCount} file(s); ${failureCount} file(s) need attention.`;
    renderFitOutputs();
    await queueRunRecordSave();
    runFitsBtn.disabled = false;
});

keepRecordCheckbox.addEventListener('change', () => {
    currentKeepRecord = isKeepRecordEnabled();
    queueRunRecordSave();
});

[
    fitColorScheme,
    overlayXAxisTitle,
    overlayYAxisTitle,
    overlayXRange,
    overlayYRange,
    overlayShowLabels,
    overlayLabelOffset,
    normalizedXAxisTitle,
    normalizedYAxisTitle,
    normalizedXRange,
    normalizedYRange,
    normalizedShowLabels,
    normalizedLabelOffset,
].forEach((control) => {
    control.addEventListener('change', () => {
        if (control === fitColorScheme) {
            updateColorSchemePreview();
        }
        refreshFitFiguresForStyleChange();
    });
});

window.addEventListener('beforeunload', () => {
    if (!currentRunId) return;
    if (isKeepRecordEnabled()) {
        const payload = JSON.stringify({
            run_id: currentRunId,
            keep_record: true,
            record: buildRunRecordSnapshot(),
        });
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon('/api/save_run_record', blob);
        }
        return;
    }

    const payload = JSON.stringify({ run_id: currentRunId });
    if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/cleanup', blob);
        return;
    }
    fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
    }).catch(() => {});
});

// UI: Handle Collapsible Sections
document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
        const section = header.closest('.sidebar-section');
        const isExpanded = header.getAttribute('aria-expanded') === 'true';

        if (isExpanded) {
            header.setAttribute('aria-expanded', 'false');
            section.classList.add('collapsed');
            header.querySelector('.arrow').textContent = '▶';
        } else {
            header.setAttribute('aria-expanded', 'true');
            section.classList.remove('collapsed');
            header.querySelector('.arrow').textContent = '▼';
        }
    });
});

currentKeepRecord = isKeepRecordEnabled();
updateColorSchemePreview();
renderFitOutputs();
