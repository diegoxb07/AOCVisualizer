"""Serves the frontend (this repo's static site) on 127.0.0.1, injecting a small script into
index.html so js/02-satellite.js's ensureReconApiReachable() knows where the locally-run API is.
The checked-in index.html shipped to GitHub Pages is never touched - only this in-memory copy
served to the desktop app's own window is modified."""
from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path


class _FrontendHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, api_port: int, **kwargs):
        self._api_port = api_port
        super().__init__(*args, **kwargs)

    def do_GET(self):
        if self.path == "/" or self.path.split("?")[0] == "/index.html":
            self._serve_index()
        else:
            super().do_GET()

    def _serve_index(self):
        index_path = Path(self.directory) / "index.html"
        html = index_path.read_text(encoding="utf-8")
        inject = f"<script>window.__AOC_LOCAL_API__='http://127.0.0.1:{self._api_port}';</script>"
        html = html.replace("<head>", "<head>\n" + inject, 1)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - matches base class signature
        pass


def start(frontend_dir: Path, port: int, api_port: int) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(_FrontendHandler, api_port=api_port, directory=str(frontend_dir))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd
