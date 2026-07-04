"""Tiny JSON-backed state file tracking what's currently installed, so the updater and the
provisioning step know whether there's anything to do."""
import json

from config import STATE_FILE


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def update_state(**kwargs):
    state = load_state()
    state.update(kwargs)
    save_state(state)
    return state
