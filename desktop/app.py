"""Desktop launcher entry point for AOC Mission Visualizer.

Run directly for development:  python desktop/app.py
Packaged builds run this same module, frozen by PyInstaller (see AOCVisualizer.spec).

Flow: check GitHub for updates to the frontend (frozen builds only - dev mode serves the live
checkout) and the vendored noaa-recon-api -> prompt if found -> provision/refresh the API's Python
runtime if needed -> start the API subprocess + the frontend static server on 127.0.0.1 -> open
the app window. If the API never becomes healthy, we still open the window: the frontend's own
ensureReconApiReachable() (js/02-satellite.js) detects that and falls back to the hosted API.
"""
from __future__ import annotations

import sys
import threading
import tkinter as tk
from tkinter import messagebox

import api_process
import provision
import static_server
import updater
from config import (
    API_BRANCH, API_REPO, FRONTEND_BRANCH, FRONTEND_DIR, FRONTEND_REPO, ICON_PATH, IS_FROZEN,
    VENDOR_DIR,
)
from state_store import load_state, update_state


class SplashWindow:
    """Minimal always-on-top status window shown while the app starts up. Real progress bar isn't
    worth the extra tkinter.ttk plumbing for what's normally a few seconds (or ~1-3 minutes on
    first run while the API runtime provisions) - a status line is enough to prove it's not hung."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("AOC Mission Visualizer")
        self.root.geometry("420x110")
        self.root.resizable(False, False)
        self.label = tk.Label(self.root, text="Starting...", font=("Segoe UI", 11), wraplength=380)
        self.label.pack(expand=True, fill="both", padx=16, pady=16)
        self.root.eval("tk::PlaceWindow . center")
        self.root.update()

    def set_status(self, text: str):
        self.label.config(text=text)
        self.root.update()

    def close(self):
        self.root.destroy()


def confirm(title: str, message: str) -> bool:
    root = tk.Tk()
    root.withdraw()
    result = messagebox.askyesno(title, message)
    root.destroy()
    return result


def check_updates(splash: SplashWindow) -> None:
    """Best-effort: any GitHub/network failure here just means 'no update available this run',
    never blocks launch."""
    state = load_state()

    if IS_FROZEN:
        splash.set_status("Checking for frontend updates...")
        try:
            latest = updater.get_latest_sha(FRONTEND_REPO, branch=FRONTEND_BRANCH)
            # Also re-check if the tracked branch itself changed since the last run (e.g. this
            # build was just switched from main to app-dev) - the stale main-branch SHA in
            # state.json would otherwise happen to differ from app-dev's HEAD anyway and still
            # trigger a redownload, but tracking the branch explicitly makes that intentional
            # rather than incidental.
            current = state.get("frontend_sha") if state.get("frontend_branch") == FRONTEND_BRANCH else None
            if latest != current:
                if current is None or confirm("Update available", "A newer version of the Mission Visualizer frontend is available. Update now?"):
                    splash.set_status("Downloading frontend update...")
                    updater.download_and_replace(FRONTEND_REPO, FRONTEND_DIR, branch=FRONTEND_BRANCH)
                    update_state(frontend_sha=latest, frontend_branch=FRONTEND_BRANCH)
        except updater.UpdateCheckFailed:
            pass

    splash.set_status("Checking for API updates...")
    try:
        latest_api = updater.get_latest_sha(API_REPO, branch=API_BRANCH)
        current_api = state.get("api_sha") if state.get("api_branch") == API_BRANCH else None
        need_download = not VENDOR_DIR.exists() or latest_api != current_api
        if need_download:
            do_it = current_api is None or confirm(
                "Update available", "A newer version of the local recon API is available. Update now?"
            )
            if do_it:
                splash.set_status("Downloading API update...")
                updater.download_and_replace(API_REPO, VENDOR_DIR, branch=API_BRANCH)
                update_state(api_sha=latest_api, api_branch=API_BRANCH)
    except updater.UpdateCheckFailed:
        pass


def ensure_api_runtime(splash: SplashWindow) -> None:
    if not VENDOR_DIR.exists():
        return  # API update-check above failed offline on a first run - nothing to provision yet.

    if not provision.is_provisioned():
        splash.set_status("Setting up local API runtime (first run, may take a few minutes)...")
        provision.provision_runtime(progress_cb=splash.set_status)
        splash.set_status("Installing API dependencies...")
        provision.install_api_dependencies(progress_cb=splash.set_status)
        update_state(requirements_fingerprint=provision.requirements_fingerprint())
        return

    state = load_state()
    current_fp = provision.requirements_fingerprint()
    if current_fp != state.get("requirements_fingerprint"):
        splash.set_status("Updating API dependencies...")
        provision.install_api_dependencies(progress_cb=splash.set_status)
        update_state(requirements_fingerprint=current_fp)


def main():
    splash = SplashWindow()

    check_updates(splash)
    ensure_api_runtime(splash)

    api_port = api_process.free_port()
    frontend_port = api_process.free_port()

    api_proc = None
    if provision.is_provisioned() and VENDOR_DIR.exists():
        splash.set_status("Starting local API server...")
        api_proc = api_process.start(api_port)
        api_process.wait_healthy(api_port, timeout=25)
        # If this times out we still continue - the frontend's satellite health badge just
        # shows offline (see js/02-satellite.js); satellite imagery stays local-only regardless.

    splash.set_status("Starting frontend server...")
    httpd = static_server.start(FRONTEND_DIR, frontend_port, api_port)

    splash.close()

    import webview  # imported late: creating a Tk root and a webview window at the same time
                     # on Windows can race for the message loop, so Tk is fully torn down first.

    window = webview.create_window(
        "AOC Mission Visualizer",
        f"http://127.0.0.1:{frontend_port}/",
        width=1400, height=900, min_size=(1000, 700),
    )
    icon = str(ICON_PATH) if ICON_PATH.exists() else None
    try:
        webview.start(icon=icon)
    finally:
        httpd.shutdown()
        api_process.stop(api_proc)


if __name__ == "__main__":
    main()
