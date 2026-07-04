"""Provisions a standalone Python runtime for running the vendored noaa-recon-api, and installs
its dependencies into it.

Deliberately NOT frozen into the launcher exe with PyInstaller: netCDF4 (native HDF5/netcdf C
extensions) is painful to statically freeze, but installs as an ordinary prebuilt wheel via pip.
Keeping the API in a real venv-like environment also means updating it later is just "re-run pip
install" - no relaunch-with-a-new-exe-build needed when noaa-recon-api's own dependencies change.

Windows only for now (the embeddable CPython distribution is a Windows-specific artifact); the
Linux port will likely just shell out to a system python3 + venv instead of embeddable Python.
"""
from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import zipfile
from pathlib import Path

import requests

from config import EMBED_PYTHON_VERSION, PYRUNTIME_DIR, VENDOR_DIR

USER_AGENT = "AOCVisualizer-Desktop-Launcher"
EMBED_URL = (
    f"https://www.python.org/ftp/python/{EMBED_PYTHON_VERSION}/"
    f"python-{EMBED_PYTHON_VERSION}-embed-amd64.zip"
)
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"


def python_exe() -> Path:
    return PYRUNTIME_DIR / "python.exe"


def is_provisioned() -> bool:
    return python_exe().exists()


def requirements_fingerprint() -> str | None:
    pyproject = VENDOR_DIR / "pyproject.toml"
    if not pyproject.exists():
        return None
    return hashlib.sha256(pyproject.read_bytes()).hexdigest()


def _run_quiet(cmd, **kwargs):
    return subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        **kwargs,
    )


def provision_runtime(progress_cb=None) -> None:
    """Downloads the embeddable Python distro and bootstraps pip into it. Wipes and recreates
    PYRUNTIME_DIR if it already exists (a from-scratch reinstall is simpler and safer than trying
    to patch a partially-broken one)."""
    if progress_cb:
        progress_cb("Downloading Python runtime...")
    if PYRUNTIME_DIR.exists():
        import shutil
        shutil.rmtree(PYRUNTIME_DIR)
    PYRUNTIME_DIR.mkdir(parents=True)

    r = requests.get(EMBED_URL, headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        zf.extractall(PYRUNTIME_DIR)

    # The embeddable distro ships with site-packages/pip disabled by default via a `._pth` file
    # that pins sys.path - uncomment its "import site" line to re-enable both.
    for pth in PYRUNTIME_DIR.glob("python*._pth"):
        text = pth.read_text(encoding="utf-8")
        pth.write_text(text.replace("#import site", "import site"), encoding="utf-8")

    if progress_cb:
        progress_cb("Installing pip...")
    get_pip = PYRUNTIME_DIR / "get-pip.py"
    r = requests.get(GET_PIP_URL, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    get_pip.write_bytes(r.content)
    _run_quiet([str(python_exe()), str(get_pip), "--no-warn-script-location"], cwd=PYRUNTIME_DIR)


def install_api_dependencies(progress_cb=None) -> None:
    """Installs the vendored noaa-recon-api (and, transitively, its pinned dependencies from its
    own pyproject.toml) as a normal package - so this file never has to hardcode or track that
    dependency list itself."""
    if progress_cb:
        progress_cb("Installing API dependencies (this can take a couple minutes)...")
    _run_quiet([
        str(python_exe()), "-m", "pip", "install", "--upgrade", "--no-warn-script-location",
        str(VENDOR_DIR),
    ])
