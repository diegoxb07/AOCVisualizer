# PyInstaller spec for the desktop launcher. Build with:
#   pyinstaller desktop/AOCVisualizer.spec --distpath desktop/dist --workpath desktop/build
#
# Deliberately onedir (not onefile): frontend/, vendor/, pyruntime/, state.json need to live as
# real sibling files next to the exe so the self-updater can update them without touching the
# frozen binary at all. Only pywebview + requests + stdlib are frozen here - the heavy scientific
# stack (netCDF4/numpy/fastapi/uvicorn) is installed into a separate provisioned Python runtime
# at first run instead (see provision.py), since those are painful to statically freeze.
import sys
from pathlib import Path

block_cipher = None
spec_dir = Path(SPECPATH)

a = Analysis(
    [str(spec_dir / "app.py")],
    pathex=[str(spec_dir)],
    binaries=[],
    # icon.ico lands at the COLLECT root (next to AOCVisualizer.exe) - config.ICON_PATH looks for
    # it there at runtime for the pywebview window/taskbar icon. The EXE(icon=...) below is a
    # separate, PyInstaller-specific embed of the same file into the .exe's own resources (what
    # Explorer/the taskbar pin shows before the app is even running).
    datas=[(str(spec_dir / "icon.ico"), ".")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AOCVisualizer",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(spec_dir / "icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="AOCVisualizer",
)
