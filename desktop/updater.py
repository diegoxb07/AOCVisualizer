"""GitHub-based update check/apply for the two repos this app depends on.

Both AOCVisualizer (the frontend) and noaa-recon-api (the API) are public repos, so this only
ever needs unauthenticated GitHub REST calls - fine at "check once per launch" frequency
(60 req/hr/IP limit). Updating means: compare the ``main`` branch's HEAD commit SHA to what we
last installed, and if it differs, download ``.../archive/refs/heads/main.zip`` (no git required)
and replace the target folder wholesale.
"""
import io
import shutil
import tempfile
import zipfile
from pathlib import Path

import requests

USER_AGENT = "AOCVisualizer-Desktop-Launcher"


class UpdateCheckFailed(Exception):
    """Raised when GitHub can't be reached; callers should treat this as 'no update available'
    rather than blocking launch."""


def get_latest_sha(repo: str, timeout: float = 5) -> str:
    try:
        r = requests.get(
            f"https://api.github.com/repos/{repo}/commits/main",
            headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()["sha"]
    except (requests.RequestException, KeyError, ValueError) as e:
        raise UpdateCheckFailed(str(e)) from e


def download_and_replace(repo: str, dest_dir: Path, timeout: float = 180, progress_cb=None) -> None:
    """Downloads the repo's main-branch zip and replaces dest_dir's contents with it."""
    url = f"https://github.com/{repo}/archive/refs/heads/main.zip"
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout, stream=True)
    r.raise_for_status()

    total = int(r.headers.get("content-length", 0))
    done = 0
    buf = io.BytesIO()
    for chunk in r.iter_content(chunk_size=1 << 16):
        buf.write(chunk)
        done += len(chunk)
        if progress_cb:
            progress_cb(done, total)
    buf.seek(0)

    with zipfile.ZipFile(buf) as zf:
        names = zf.namelist()
        if not names:
            raise RuntimeError(f"empty archive for {repo}")
        top = names[0].split("/")[0]
        with tempfile.TemporaryDirectory() as tmp:
            zf.extractall(tmp)
            src = Path(tmp) / top
            dest_dir.parent.mkdir(parents=True, exist_ok=True)
            if dest_dir.exists():
                shutil.rmtree(dest_dir)
            shutil.copytree(src, dest_dir)
