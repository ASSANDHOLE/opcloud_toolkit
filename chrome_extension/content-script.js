(function () {
    const PAGE_REQUEST_SOURCE = "opcloud-toolkit-extension";
    const PAGE_RESPONSE_SOURCE = "opcloud-toolkit-page";
    const pending = new Map();
    let injectPromise = null;
    let overlayEl = null;

    function ensureOverlay() {
        if (overlayEl && document.documentElement.contains(overlayEl)) {
            return overlayEl;
        }

        overlayEl = document.createElement("div");
        overlayEl.id = "opcloud-toolkit-overlay";
        overlayEl.style.cssText = [
            "position:fixed",
            "inset:0",
            "display:none",
            "align-items:center",
            "justify-content:center",
            "background:rgba(28,27,23,0.18)",
            "backdrop-filter:blur(2px)",
            "z-index:2147483647",
            "pointer-events:auto"
        ].join(";");

        const card = document.createElement("div");
        card.style.cssText = [
            "display:flex",
            "align-items:center",
            "gap:12px",
            "padding:14px 18px",
            "border-radius:14px",
            "background:#fffaf2",
            "border:1px solid #d7c9af",
            "box-shadow:0 10px 30px rgba(0,0,0,0.18)",
            "font:14px/1.4 'Segoe UI',sans-serif",
            "color:#2a241d"
        ].join(";");

        const spinner = document.createElement("div");
        spinner.style.cssText = [
            "width:18px",
            "height:18px",
            "border-radius:50%",
            "border:3px solid #d9e8e1",
            "border-top-color:#2b6f5b",
            "animation:opcloudToolkitSpin 0.9s linear infinite"
        ].join(";");

        const text = document.createElement("div");
        text.id = "opcloud-toolkit-overlay-text";
        text.textContent = "Working...";

        card.appendChild(spinner);
        card.appendChild(text);
        overlayEl.appendChild(card);

        if (!document.getElementById("opcloud-toolkit-overlay-style")) {
            const style = document.createElement("style");
            style.id = "opcloud-toolkit-overlay-style";
            style.textContent = "@keyframes opcloudToolkitSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
            document.documentElement.appendChild(style);
        }

        document.documentElement.appendChild(overlayEl);
        return overlayEl;
    }

    function showOverlay(message) {
        const el = ensureOverlay();
        const text = el.querySelector("#opcloud-toolkit-overlay-text");
        if (text) {
            text.textContent = message || "Working...";
        }
        el.style.display = "flex";
    }

    function hideOverlay() {
        if (overlayEl) {
            overlayEl.style.display = "none";
        }
    }

    function getOverlayMessage(action) {
        if (action === "bootstrap") return "Bootstrapping OPCloud toolkit...";
        if (action === "importTree") return "Importing OPCloud data...";
        if (action === "exportTree") return "Exporting OPCloud tree...";
        if (action === "exportCurrent") return "Exporting current OPD...";
        return "Working...";
    }

    function injectPageScript(fileName, marker) {
        if (document.documentElement.dataset[marker] === "1") {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL(fileName);
            script.async = false;
            script.onload = () => {
                document.documentElement.dataset[marker] = "1";
                script.remove();
                resolve();
            };
            script.onerror = () => {
                script.remove();
                reject(new Error(`Failed to inject ${fileName}`));
            };
            (document.head || document.documentElement).appendChild(script);
        });
    }

    function ensureInjected() {
        if (!injectPromise) {
            injectPromise = Promise.all([
                injectPageScript("toolkit.js", "opcloudToolkitInjected"),
                injectPageScript("page-bridge.js", "opcloudToolkitBridgeInjected")
            ]);
        }
        return injectPromise;
    }

    function serializeError(error) {
        return {
            message: error?.message || String(error),
            stack: error?.stack || null
        };
    }

    function callPage(action, payload) {
        return new Promise((resolve, reject) => {
            const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const timeoutId = window.setTimeout(() => {
                pending.delete(requestId);
                reject(new Error(`Timed out while waiting for "${action}"`));
            }, 120000);

            pending.set(requestId, {resolve, reject, timeoutId});
            window.postMessage({
                source: PAGE_REQUEST_SOURCE,
                requestId,
                action,
                payload
            }, "*");
        });
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== PAGE_RESPONSE_SOURCE || !data.requestId) return;

        const entry = pending.get(data.requestId);
        if (!entry) return;

        pending.delete(data.requestId);
        window.clearTimeout(entry.timeoutId);

        if (data.ok) {
            entry.resolve(data.result);
        } else {
            entry.reject(new Error(data.error?.message || "Unknown page error"));
        }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== "opcloud-toolkit") {
            return undefined;
        }

        const shouldOverlay = message.action !== "status";
        if (shouldOverlay) {
            showOverlay(getOverlayMessage(message.action));
        }

        ensureInjected()
            .then(() => callPage(message.action, message.payload))
            .then((result) => sendResponse({ok: true, result}))
            .catch((error) => sendResponse({ok: false, error: serializeError(error)}))
            .finally(() => {
                if (shouldOverlay) {
                    hideOverlay();
                }
            });

        return true;
    });

    ensureInjected().catch(() => {
    });
})();
