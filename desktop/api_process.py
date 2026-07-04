"""Starts/stops the vendored noaa-recon-api as a subprocess (run unmodified, exactly the way its
own README documents: ``uvicorn app.main:app``), and polls its health endpoint."""
from __future__ import annotations

import socket
import subprocess
import sys
import time
from pathlib import Path

import requests

from config import LOG_DIR, VENDOR_DIR
import provision


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(port: int) -> subprocess.Popen:
    log_path = LOG_DIR / "api.log"
    log_file = open(log_path, "ab")
    return subprocess.Popen(
        [
            str(provision.python_exe()), "-m", "uvicorn", "app.main:app",
            "--host", "127.0.0.1", "--port", str(port),
        ],
        cwd=str(VENDOR_DIR),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )


def wait_healthy(port: int, timeout: float = 25) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/v1/satellite/products"
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=2)
            if r.status_code < 500:
                return True
        except requests.RequestException:
            pass
        time.sleep(0.5)
    return False


def stop(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
