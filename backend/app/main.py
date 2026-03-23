from __future__ import annotations

import json
import math
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from scipy.optimize import curve_fit

from .srs_extractor.extract_core import run_extraction

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
RUNS_DIR = BASE_DIR.parent / "data" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Multi SRS Kinetics App")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _kinetics_model(x: np.ndarray, yb: float, a: float, td: float, tau: float) -> np.ndarray:
    tau = max(float(tau), 1e-9)
    return yb + a * (1.0 - np.exp(-(x - td) / tau))


def _guess_initial(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float, float]:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    td = float(np.min(x))
    yb = float(y[0])
    a = float(y[-1] - y[0])
    if abs(a) < 1e-12:
        a = float(np.nanmax(y) - np.nanmin(y))
    if abs(a) < 1e-12:
        a = 1.0

    target = yb + 0.632 * a
    idx = int(np.argmin(np.abs(y - target)))
    tau = float(max(x[idx] - td, 1e-6))
    return yb, a, td, tau


def _get_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    return plt


def _style_axes(ax: Any, xlabel: str, ylabel: str) -> None:
    ax.set_xlabel(xlabel, fontsize=11, fontname="Arial")
    ax.set_ylabel(ylabel, fontsize=11, fontname="Arial")
    ax.tick_params(
        axis="both",
        direction="in",
        labelsize=10,
        width=0.8,
        length=4,
        top=False,
        right=False,
    )
    for label in ax.get_xticklabels() + ax.get_yticklabels():
        label.set_fontname("Arial")
    for spine in ax.spines.values():
        spine.set_linewidth(0.8)
        spine.set_edgecolor("black")
    ax.grid(False)


def _coerce_axis_range(values: Any) -> tuple[float, float] | None:
    if not isinstance(values, (list, tuple)) or len(values) != 2:
        return None
    try:
        lo = float(values[0])
        hi = float(values[1])
    except Exception:
        return None
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return None
    return (lo, hi) if lo <= hi else (hi, lo)


def _coerce_label_offset(values: Any) -> tuple[float, float]:
    if not isinstance(values, (list, tuple)) or len(values) != 2:
        return 0.0, 0.0
    try:
        dx = float(values[0]) / 100.0
        dy = float(values[1]) / 100.0
    except Exception:
        return 0.0, 0.0
    return dx, dy


def _add_curve_labels(ax: Any, default_loc: str, offset_values: Any) -> None:
    dx, dy = _coerce_label_offset(offset_values)
    anchor_map = {
        "upper right": (1.0, 1.0),
        "lower right": (1.0, 0.0),
        "upper left": (0.0, 1.0),
        "lower left": (0.0, 0.0),
    }
    base_x, base_y = anchor_map.get(default_loc, (1.0, 1.0))
    ax.legend(
        loc=default_loc,
        bbox_to_anchor=(base_x + dx, base_y - dy),
        frameon=False,
        fontsize=9,
        handlelength=1.5,
        labelspacing=0.3,
        borderaxespad=0.0,
        prop={"family": "Arial"},
    )


def _save_fit_overlay_figure(target_path: Path, series: list[dict[str, Any]], figure_settings: dict[str, Any] | None = None) -> None:
    plt = _get_matplotlib()
    fig, ax = plt.subplots(figsize=(10 / 2.54, 8 / 2.54), dpi=300, facecolor="white")
    figure_settings = figure_settings or {}

    for item in series:
        color = str(item["color"])
        label = str(item["label"])
        x_full = np.asarray(item["full_time"], dtype=float)
        y_full = np.asarray(item["full_areas"], dtype=float)
        x_fit = np.asarray(item["x_fit"], dtype=float)
        y_fit = np.asarray(item["y_fit"], dtype=float)
        ax.plot(x_full, y_full, color=color, linewidth=1.3, label=label)
        ax.plot(x_fit, y_fit, color=color, linewidth=1.3, linestyle="--")

    _style_axes(
        ax,
        str(figure_settings.get("xlabel") or "Time / Potential"),
        str(figure_settings.get("ylabel") or "Peak Area"),
    )
    xlim = _coerce_axis_range(figure_settings.get("xlim"))
    ylim = _coerce_axis_range(figure_settings.get("ylim"))
    if xlim:
        ax.set_xlim(*xlim)
    if ylim:
        ax.set_ylim(*ylim)
    if figure_settings.get("show_labels", True):
        _add_curve_labels(ax, "upper right", figure_settings.get("label_offset"))
    fig.subplots_adjust(left=0.18, right=0.93, bottom=0.15, top=0.90)
    fig.savefig(target_path, dpi=300, bbox_inches=None, pad_inches=0.1, facecolor=fig.get_facecolor(), transparent=False)
    plt.close(fig)


def _save_fit_normalized_figure(target_path: Path, series: list[dict[str, Any]], figure_settings: dict[str, Any] | None = None) -> None:
    plt = _get_matplotlib()
    fig, ax = plt.subplots(figsize=(10 / 2.54, 8 / 2.54), dpi=300, facecolor="white")
    figure_settings = figure_settings or {}

    for item in series:
        color = str(item["color"])
        label = str(item["label"])
        x_raw = np.asarray(item["x_raw"], dtype=float)
        y_raw = np.asarray(item["y_raw"], dtype=float)
        x_fit = np.asarray(item["x_fit"], dtype=float)
        y_fit = np.asarray(item["y_fit"], dtype=float)
        ax.scatter(
            x_raw,
            y_raw,
            s=20,
            facecolors="none",
            edgecolors=color,
            linewidths=1.3,
            label=label,
        )
        ax.plot(x_fit, y_fit, color=color, linewidth=1.3)

    _style_axes(
        ax,
        str(figure_settings.get("xlabel") or "Time / Potential"),
        str(figure_settings.get("ylabel") or "Normalized Peak Area"),
    )
    xlim = _coerce_axis_range(figure_settings.get("xlim"))
    ylim = _coerce_axis_range(figure_settings.get("ylim"))
    if xlim:
        ax.set_xlim(*xlim)
    if ylim:
        ax.set_ylim(*ylim)
    if figure_settings.get("show_labels", True):
        _add_curve_labels(ax, "lower right", figure_settings.get("label_offset"))
    fig.subplots_adjust(left=0.18, right=0.93, bottom=0.15, top=0.90)
    fig.savefig(target_path, dpi=300, bbox_inches=None, pad_inches=0.1, facecolor=fig.get_facecolor(), transparent=False)
    plt.close(fig)


def _parse_timeseries_txt(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        header_line = f.readline().rstrip("\n")
    if not header_line.startswith("\t"):
        raise ValueError("Invalid timeseries txt header format.")
    wn = np.array([float(v) for v in header_line.split("\t")[1:] if v], dtype=float)
    data = np.loadtxt(path, delimiter="\t", skiprows=1)
    if data.ndim == 1:
        data = data.reshape(1, -1)
    time_axis = data[:, 0].astype(float)
    spectra = data[:, 1:].astype(float)
    if spectra.shape[1] != wn.shape[0]:
        raise ValueError("Wavenumber count and spectra width mismatch.")
    return {
        "wavenumbers": wn.tolist(),
        "time": time_axis.tolist(),
        "spectra": spectra.tolist(),
    }


def _load_run_dataset(run_id: str, filename: str) -> dict[str, Any]:
    run_dir = RUNS_DIR / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="run_id not found")

    stem = Path(filename).stem
    ts_path = run_dir / f"{stem}.txt"
    if not ts_path.exists():
        raise HTTPException(status_code=404, detail=f"Extracted file not found: {stem}.txt")

    try:
        return _parse_timeseries_txt(ts_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse dataset: {e}") from e


def _prune_temp_runs(max_keep: int = 5) -> None:
    temp_dirs = [p for p in RUNS_DIR.glob("*") if p.is_dir() and (p / ".temp").exists()]
    temp_dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for stale_dir in temp_dirs[max_keep:]:
        try:
            shutil.rmtree(stale_dir)
        except Exception:
            pass


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _set_run_keep_record(run_dir: Path, keep_record: bool) -> None:
    temp_marker = run_dir / ".temp"
    if keep_record:
        if temp_marker.exists():
            temp_marker.unlink()
    else:
        temp_marker.touch(exist_ok=True)


def _write_run_record(run_dir: Path, keep_record: bool, record: dict[str, Any]) -> Path:
    payload = dict(record)
    payload["run_id"] = run_dir.name
    payload["keep_record"] = keep_record
    payload["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    record_path = run_dir / "run_record.json"
    record_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return record_path


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/list_folder")
async def list_folder(payload: dict[str, str]) -> dict[str, Any]:
    folder_path = payload.get("folder_path", "").strip()
    if not folder_path:
        raise HTTPException(status_code=400, detail="Missing folder_path")

    path_obj = Path(folder_path)
    if not path_obj.exists() or not path_obj.is_dir():
        raise HTTPException(status_code=400, detail="Path does not exist or is not a directory")

    srs_files: list[str] = []
    try:
        for item in path_obj.iterdir():
            if item.is_file() and ".srs" in item.name.lower():
                srs_files.append(item.name)
        srs_files.sort()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading directory: {e}")

    return {"folder_path": str(path_obj), "files": srs_files}


@app.post("/api/extract_all")
async def extract_all(payload: dict[str, Any]) -> dict[str, Any]:
    """Extract a batch of selected SRS files from a folder.

    Payload:
        folder_path: absolute path to the source folder
        files: ordered list of filenames to extract
        mode: 'fast' or 'realtime'
        start: start wavenumber
        end: end wavenumber
    """
    folder_path = str(payload.get("folder_path", "")).strip()
    files: list[str] = list(payload.get("files", []))
    mode = str(payload.get("mode", "realtime")).strip().lower()
    start = float(payload.get("start", 1150))
    end = float(payload.get("end", 4000))
    keep_record = _as_bool(payload.get("keep_record", False))

    if not folder_path or not files:
        raise HTTPException(status_code=400, detail="folder_path and files are required")
    if mode not in {"fast", "realtime"}:
        raise HTTPException(status_code=400, detail="mode must be 'fast' or 'realtime'")

    source_dir = Path(folder_path)
    if not source_dir.is_dir():
        raise HTTPException(status_code=400, detail="folder_path is not a valid directory")

    # Create a run directory; temporary runs are marked for later cleanup.
    run_id = next(tempfile._get_candidate_names())
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    _set_run_keep_record(run_dir, keep_record)

    _prune_temp_runs(max_keep=5)

    succeeded: list[str] = []
    failed: dict[str, str] = {}

    for filename in files:
        srs_src = source_dir / filename
        if not srs_src.is_file():
            failed[filename] = "File not found in folder"
            continue
        # Copy to run dir so the extractor can work there
        dest = run_dir / filename
        try:
            shutil.copy2(str(srs_src), str(dest))
            run_extraction(
                srs_path=str(dest),
                mode=mode,
                outdir=str(run_dir),
                start_wn=start,
                end_wn=end,
            )
            # Verify the txt was produced
            stem = Path(filename).stem
            if (run_dir / f"{stem}.txt").exists():
                succeeded.append(filename)
            else:
                failed[filename] = "Extraction produced no output"
        except Exception as e:
            failed[filename] = str(e)

    if not succeeded:
        raise HTTPException(status_code=500, detail=f"All extractions failed: {failed}")

    return {
        "run_id": run_id,
        "succeeded": succeeded,
        "failed": failed,
        "keep_record": keep_record,
    }


@app.post("/api/get_dataset")
async def get_dataset(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the parsed timeseries data for a single extracted file."""
    run_id = str(payload.get("run_id", "")).strip()
    filename = str(payload.get("filename", "")).strip()

    if not run_id or not filename:
        raise HTTPException(status_code=400, detail="run_id and filename are required")

    parsed = _load_run_dataset(run_id, filename)
    return {"filename": filename, **parsed}


def _trapz_area(x: np.ndarray, y: np.ndarray) -> float:
    if x.size < 2 or y.size < 2:
        return float("nan")
    return float(np.trapz(y, x))


@app.post("/api/integrate")
async def integrate(payload: dict[str, Any]) -> dict[str, Any]:
    """Integrate the area under the spectrum between two wavenumber limits.

    Payload:
        wavenumbers, time, spectra: dataset arrays
        start: lower wavenumber bound
        end: upper wavenumber bound
        baseline_mode: 'none' or 'linear'
    """
    baseline_mode = str(payload.get("baseline_mode", "none"))
    try:
        start = float(payload["start"])
        end = float(payload["end"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid integration window: {e}") from e

    if "wavenumbers" in payload and "time" in payload and "spectra" in payload:
        try:
            wn = np.asarray(payload["wavenumbers"], dtype=float)
            time_axis = np.asarray(payload["time"], dtype=float)
            spectra = np.asarray(payload["spectra"], dtype=float)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid payload: {e}") from e
    else:
        run_id = str(payload.get("run_id", "")).strip()
        filename = str(payload.get("filename", "")).strip()
        if not run_id or not filename:
            raise HTTPException(
                status_code=400,
                detail="Provide either dataset arrays or run_id + filename for integration",
            )
        parsed = _load_run_dataset(run_id, filename)
        wn = np.asarray(parsed["wavenumbers"], dtype=float)
        time_axis = np.asarray(parsed["time"], dtype=float)
        spectra = np.asarray(parsed["spectra"], dtype=float)

    if spectra.ndim != 2 or spectra.shape[0] != time_axis.size or spectra.shape[1] != wn.size:
        raise HTTPException(status_code=400, detail="spectra/time/wavenumber shape mismatch")

    lo, hi = (start, end) if start <= end else (end, start)
    mask = (wn >= lo) & (wn <= hi)
    if np.count_nonzero(mask) < 2:
        raise HTTPException(status_code=400, detail="Integration window needs at least 2 wavenumber points")

    x_sel = wn[mask]
    areas = []
    for row in spectra:
        y_sel = row[mask].astype(float)
        if baseline_mode == "linear":
            baseline = np.interp(x_sel, [x_sel[0], x_sel[-1]], [y_sel[0], y_sel[-1]])
            y_sel = y_sel - baseline
        areas.append(_trapz_area(x_sel, y_sel))

    return {"time": time_axis.tolist(), "areas": areas, "window": [lo, hi], "baseline_mode": baseline_mode}


@app.post("/api/fit-kinetics")
async def fit_kinetics(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        x = np.asarray(payload["x"], dtype=float)
        y = np.asarray(payload["y"], dtype=float)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid x/y payload: {e}") from e

    if x.size < 4 or y.size < 4 or x.size != y.size:
        raise HTTPException(status_code=400, detail="x/y must have same length and >= 4")
    if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
        raise HTTPException(status_code=400, detail="x/y contains non-finite values")

    order = np.argsort(x)
    x = x[order]
    y = y[order]
    p0 = _guess_initial(x, y)

    tau_upper = float(max(np.ptp(x) * 100.0, 1.0))
    bounds = (
        [-math.inf, -math.inf, float(np.min(x)), 1e-9],
        [math.inf, math.inf, float(np.max(x)), tau_upper],
    )

    try:
        popt, pcov = curve_fit(
            _kinetics_model,
            x,
            y,
            p0=p0,
            bounds=bounds,
            maxfev=400,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"fit failed: {e}") from e

    y_fit = _kinetics_model(x, *popt)
    resid = y - y_fit
    ss_res = float(np.sum(resid ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float("nan")
    rmse = float(np.sqrt(np.mean(resid ** 2)))

    ci95 = [None] * 4
    if pcov is not None and np.all(np.isfinite(pcov)):
        se = np.sqrt(np.diag(pcov))
        ci95 = [(float(v - 1.96 * s), float(v + 1.96 * s)) for v, s in zip(popt, se)]

    return {
        "params": {"Yb": float(popt[0]), "A": float(popt[1]), "TD": float(popt[2]), "Tau": float(popt[3])},
        "init_guess": {"Yb": float(p0[0]), "A": float(p0[1]), "TD": float(p0[2]), "Tau": float(p0[3])},
        "metrics": {"r2": r2, "rmse": rmse},
        "ci95": {"Yb": ci95[0], "A": ci95[1], "TD": ci95[2], "Tau": ci95[3]},
        "x_sorted": x.tolist(),
        "y_fit": y_fit.tolist(),
        "residuals": resid.tolist(),
    }


@app.post("/api/render-fit-figures")
async def render_fit_figures(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = str(payload.get("run_id", "")).strip()
    series = list(payload.get("series", []))
    figure_settings = payload.get("figure_settings", {})
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    if not series:
        raise HTTPException(status_code=400, detail="series is required")

    run_dir = RUNS_DIR / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="run_id not found")

    try:
        overlay_series = []
        normalized_series = []
        for item in series:
            overlay_series.append({
                "label": item["label"],
                "color": item["color"],
                "full_time": item["full_time"],
                "full_areas": item["full_areas"],
                "x_fit": item["x_fit"],
                "y_fit": item["y_fit"],
            })
            normalized_series.append({
                "label": item["label"],
                "color": item["color"],
                "x_raw": item["x_raw"],
                "y_raw": item["y_raw"],
                "x_fit": item["x_fit"],
                "y_fit": item["y_fit_norm"],
            })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid series payload: {e}") from e

    overlay_path = run_dir / "fit_overlay.png"
    normalized_path = run_dir / "fit_normalized.png"

    try:
        overlay_settings = figure_settings.get("overlay", {}) if isinstance(figure_settings, dict) else {}
        normalized_settings = figure_settings.get("normalized", {}) if isinstance(figure_settings, dict) else {}
        _save_fit_overlay_figure(overlay_path, overlay_series, overlay_settings)
        _save_fit_normalized_figure(normalized_path, normalized_series, normalized_settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render fit figures: {e}") from e

    stamp = int(time.time() * 1000)
    return {
        "overlay_url": f"/api/fit-figure/{run_id}/overlay?ts={stamp}",
        "normalized_url": f"/api/fit-figure/{run_id}/normalized?ts={stamp}",
    }


@app.get("/api/fit-figure/{run_id}/{kind}")
async def get_fit_figure(run_id: str, kind: str) -> FileResponse:
    run_dir = RUNS_DIR / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="run_id not found")

    name_map = {
        "overlay": "fit_overlay.png",
        "normalized": "fit_normalized.png",
    }
    if kind not in name_map:
        raise HTTPException(status_code=404, detail="Unknown figure kind")

    figure_path = run_dir / name_map[kind]
    if not figure_path.is_file():
        raise HTTPException(status_code=404, detail="Figure not found")

    return FileResponse(str(figure_path), media_type="image/png")


@app.post("/api/save_run_record")
async def save_run_record(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = str(payload.get("run_id", "")).strip()
    keep_record = _as_bool(payload.get("keep_record", False))
    record = payload.get("record", {})

    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    if not isinstance(record, dict):
        raise HTTPException(status_code=400, detail="record must be an object")

    run_dir = RUNS_DIR / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="run_id not found")

    try:
        _set_run_keep_record(run_dir, keep_record)
        record_path = _write_run_record(run_dir, keep_record, record)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save run record: {e}") from e

    return {
        "run_id": run_id,
        "keep_record": keep_record,
        "record_path": str(record_path),
    }


@app.post("/api/cleanup")
async def cleanup(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = str(payload.get("run_id", "")).strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    run_dir = RUNS_DIR / run_id
    if run_dir.exists() and run_dir.is_dir():
        shutil.rmtree(run_dir)
    return {"deleted": run_id}
