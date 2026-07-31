// Who may press the write buttons.
//
// This runs in the browser, so it is a convenience and not a security boundary:
// it stops an accidental click and a casual visitor, nothing more. The thing
// that actually protects the sheet is APPS_SCRIPT_TOKEN, which Code.gs checks
// before it touches a cell. SETUP.txt section 7 explains how to move the
// password check into Apps Script if this ever needs to be real.

import { OWNER_PASSWORD, OWNER_NAME, SESSION_DAYS } from "../config.js";
import { isConfigured } from "./writer.js";
import { store } from "../core/util.js";

const KEY = "sidcinema-owner";

export function bridgeReady() {
  return isConfigured();
}

export function configured() {
  return Boolean(OWNER_PASSWORD);
}

export function isOwner() {
  const session = store.getJSON(KEY);
  if (!session || !session.until) return false;
  if (Date.now() > session.until) {
    store.remove(KEY);
    return false;
  }
  return true;
}

export function signIn(password) {
  if (!configured()) return { ok: false, reason: "not_configured" };
  if (String(password || "") !== OWNER_PASSWORD) return { ok: false, reason: "wrong" };

  store.setJSON(KEY, { until: Date.now() + SESSION_DAYS * 86400000 });
  return { ok: true };
}

// Two failure modes, answered differently on purpose:
//   not_configured - nobody can write; the UI should stop offering it
//   auth_required  - the right person could; the UI should ask who this is
export function status() {
  return {
    owner: isOwner(),
    configured: configured(),
    bridge_ready: bridgeReady(),
    owner_name: OWNER_NAME
  };
}
