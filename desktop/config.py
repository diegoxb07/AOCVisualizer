"""Shared paths and constants for the desktop launcher.

Two run modes:
  - Frozen (PyInstaller build): the exe lives at the root of the portable folder, and
    ``frontend/``, ``vendor/``, ``pyruntime/`` and ``state.json`` are real sibling files/folders
    next to it so the self-updater can update them without touching the exe itself.
  - Dev (``python desktop/app.py`` from a checkout): serves this repo's own root as the frontend
    (no snapshot copy, so local edits show up immediately) and keeps downloaded/generated state
    under ``desktop/.devdata/`` so it never pollutes the repo.
"""
import sys
from pathlib import Path

FRONTEND_REPO = "diegoxb07/AOCVisualizer"
API_REPO = "jjmurdock19/noaa-recon-api"

# Branch the self-updater tracks for each repo - not necessarily "main". Currently pointed at the
# in-development branch for the frontend while this desktop-app work is still being reviewed;
# flip back to "main" once app-dev is merged, so office installs track the released code again.
FRONTEND_BRANCH = "app-dev"
API_BRANCH = "main"

IS_FROZEN = bool(getattr(sys, "frozen", False))

if IS_FROZEN:
    PORTABLE_ROOT = Path(sys.executable).resolve().parent
    FRONTEND_DIR = PORTABLE_ROOT / "frontend"
    # sys._MEIPASS is the bootloader-set directory holding bundled `datas` files - in PyInstaller
    # 6.x onedir builds that's `_internal/`, not the exe's own folder, and that internal layout
    # isn't something to hardcode/rely on across versions.
    ICON_PATH = Path(getattr(sys, "_MEIPASS", PORTABLE_ROOT)) / "icon.ico"
else:
    REPO_ROOT = Path(__file__).resolve().parent.parent
    PORTABLE_ROOT = Path(__file__).resolve().parent / ".devdata"
    FRONTEND_DIR = REPO_ROOT
    ICON_PATH = Path(__file__).resolve().parent / "icon.ico"

PORTABLE_ROOT.mkdir(parents=True, exist_ok=True)

VENDOR_DIR = PORTABLE_ROOT / "vendor" / "noaa-recon-api"
PYRUNTIME_DIR = PORTABLE_ROOT / "pyruntime"
STATE_FILE = PORTABLE_ROOT / "state.json"
LOG_DIR = PORTABLE_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Pinned so we know netCDF4/numpy/fastapi/uvicorn all have prebuilt Windows wheels available.
EMBED_PYTHON_VERSION = "3.11.9"
