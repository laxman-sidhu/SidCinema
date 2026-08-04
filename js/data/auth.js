// A browser-side convenience, not a security boundary - APPS_SCRIPT_TOKEN is what actually protects the sheet. See SETUP.txt section 7.

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

// not_configured: nobody can write, so stop offering it. auth_required: the right person could, so ask who this is.
export function status() {
  return {
    owner: isOwner(),
    configured: configured(),
    bridge_ready: bridgeReady(),
    owner_name: OWNER_NAME
  };
}
