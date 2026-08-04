// Feedback for anything that takes a round trip. A pending toast is returned as a handle, so one action leaves one strip on screen.

let host = null;

function mount() {
  // Rebuilt when the cached host has left the document, or every toast is swallowed silently.
  if (host && host.isConnected && host.ownerDocument === document) return host;
  host = document.createElement("div");
  host.className = "toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

const SPINNER = '<span class="toast__spin" aria-hidden="true"></span>';
const TICK = '<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';
const CROSS = '<svg class="toast__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function build(text, kind) {
  const node = document.createElement("div");
  node.className = `toast toast--${kind}`;
  node.innerHTML = (kind === "pending" ? SPINNER : kind === "error" ? CROSS : TICK)
    + `<span class="toast__text"></span>`;
  node.querySelector(".toast__text").textContent = text;
  return node;
}

function dismiss(node, after) {
  setTimeout(() => {
    node.classList.remove("is-on");
    setTimeout(() => node.remove(), 220);
  }, after);
}

// A handle, not fire-and-forget: call succeed or fail on it when the wire answers.
export function pending(text) {
  const node = build(text, "pending");
  mount().appendChild(node);
  requestAnimationFrame(() => node.classList.add("is-on"));

  let settled = false;

  function settle(kind, message, linger) {
    if (settled) return;
    settled = true;
    node.className = `toast toast--${kind} is-on`;
    node.innerHTML = (kind === "error" ? CROSS : TICK) + '<span class="toast__text"></span>';
    node.querySelector(".toast__text").textContent = message;
    dismiss(node, linger);
  }

  return {
    succeed: message => settle("done", message, 2200),
    fail: message => settle("error", message, 4200),
    // Nothing happened after all - the user cancelled the dialog.
    cancel() {
      if (settled) return;
      settled = true;
      node.classList.remove("is-on");
      setTimeout(() => node.remove(), 220);
    }
  };
}

export function show(text, kind = "done") {
  const node = build(text, kind);
  mount().appendChild(node);
  requestAnimationFrame(() => node.classList.add("is-on"));
  dismiss(node, kind === "error" ? 4200 : 2200);
  return node;
}

export function error(text) {
  return show(text, "error");
}
