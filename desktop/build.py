"""Builds the portable desktop app: runs PyInstaller into a throwaway staging folder, then merges
just the exe + its _internal/ support files into dist/AOCVisualizer/ - and refreshes frontend/
with a snapshot of this repo's current static assets. Run from anywhere:  python desktop/build.py

Deliberately does NOT let PyInstaller collect straight into dist/AOCVisualizer/: PyInstaller wipes
its whole output directory on every build, which would also delete vendor/, pyruntime/,
state.json, and logs/ - the runtime-provisioned data that lives alongside the exe in the portable
folder (see config.py) and is expensive to regenerate (a fresh vendor/ download,
`pip install`ing netCDF4/numpy/etc. into pyruntime/ from scratch). Staging PyInstaller's output
separately and merging just the binary keeps rebuilds from nuking that data.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

DESKTOP_DIR = Path(__file__).resolve().parent
REPO_ROOT = DESKTOP_DIR.parent
STAGING_DIR = DESKTOP_DIR / "_pyinstaller_dist"
DIST_DIR = DESKTOP_DIR / "dist" / "AOCVisualizer"

# What actually ships to the browser/webview - mirrors the <script>/<link> tags in index.html.
FRONTEND_ITEMS = ["index.html", "css", "js", "lib", "data", "fonts", "assets"]


def run_pyinstaller():
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            str(DESKTOP_DIR / "AOCVisualizer.spec"),
            "--distpath", str(STAGING_DIR),
            "--workpath", str(DESKTOP_DIR / "build"),
            "--noconfirm",
        ],
        check=True,
    )


def merge_exe_into_dist():
    """Copies the freshly-built exe + _internal/ into the persistent portable folder, leaving
    vendor/, pyruntime/, state.json, and logs/ (if already there from a prior run) untouched."""
    staged = STAGING_DIR / "AOCVisualizer"
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    dest_internal = DIST_DIR / "_internal"
    if dest_internal.exists():
        shutil.rmtree(dest_internal)
    shutil.copytree(staged / "_internal", dest_internal)
    shutil.copy2(staged / "AOCVisualizer.exe", DIST_DIR / "AOCVisualizer.exe")


def seed_frontend():
    frontend_dest = DIST_DIR / "frontend"
    if frontend_dest.exists():
        shutil.rmtree(frontend_dest)
    frontend_dest.mkdir(parents=True)
    for name in FRONTEND_ITEMS:
        src = REPO_ROOT / name
        if not src.exists():
            continue
        dest = frontend_dest / name
        if src.is_dir():
            shutil.copytree(src, dest)
        else:
            shutil.copy2(src, dest)


def main():
    run_pyinstaller()
    merge_exe_into_dist()
    seed_frontend()
    shutil.rmtree(STAGING_DIR, ignore_errors=True)
    print(f"Portable build ready at: {DIST_DIR}")


if __name__ == "__main__":
    main()
