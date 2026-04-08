const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const activityLog = document.getElementById("activityLog");
const busyIndicator = document.getElementById("busyIndicator");
const busyText = document.getElementById("busyText");
const bootstrapButton = document.getElementById("bootstrapButton");
const refreshStatusButton = document.getElementById("refreshStatusButton");
const downloadExportButton = document.getElementById("downloadExportButton");
const copyExportButton = document.getElementById("copyExportButton");
const refreshLocationsButton = document.getElementById("refreshLocationsButton");
const importFileButton = document.getElementById("importFileButton");
const importTextButton = document.getElementById("importTextButton");
const clearTextButton = document.getElementById("clearTextButton");
const fileInput = document.getElementById("fileInput");
const jsonInput = document.getElementById("jsonInput");
const locationSummary = document.getElementById("locationSummary");
const locationList = document.getElementById("locationList");
const SUPPORTED_ORIGIN = "https://opcloud-sandbox.web.app";

function setLog(message) {
    activityLog.textContent = message;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBusy(isBusy) {
    document.body.dataset.busy = isBusy ? "1" : "0";
    busyIndicator.classList.toggle("hidden", !isBusy);
    bootstrapButton.disabled = isBusy || bootstrapButton.dataset.locked === "1";
    refreshStatusButton.disabled = isBusy;
    downloadExportButton.disabled = isBusy || downloadExportButton.dataset.locked === "1";
    copyExportButton.disabled = isBusy || copyExportButton.dataset.locked === "1";
    refreshLocationsButton.disabled = isBusy || refreshLocationsButton.dataset.locked === "1";
    importFileButton.disabled = isBusy || importFileButton.dataset.locked === "1";
    importTextButton.disabled = isBusy || importTextButton.dataset.locked === "1";
}

function setBusyState(isBusy, label = "Working...") {
    busyText.textContent = label;
    setBusy(isBusy);
}

function disableForUnsupportedSite(message) {
    setStatusBadge("Unsupported Site", "error");
    statusText.textContent = message;
    bootstrapButton.dataset.locked = "1";
    downloadExportButton.dataset.locked = "1";
    copyExportButton.dataset.locked = "1";
    refreshLocationsButton.dataset.locked = "1";
    importFileButton.dataset.locked = "1";
    importTextButton.dataset.locked = "1";
    fileInput.disabled = true;
    locationSummary.textContent = "Open OPCloud Sandbox in the active tab.";
    renderLocationItems([]);
    setBusy(false);
}

function setEnabledWhenBootstrapped(isBootstrapped) {
    const lock = isBootstrapped ? "0" : "1";
    downloadExportButton.dataset.locked = lock;
    copyExportButton.dataset.locked = lock;
    refreshLocationsButton.dataset.locked = lock;
    importFileButton.dataset.locked = lock;
    importTextButton.dataset.locked = lock;
    fileInput.disabled = !isBootstrapped;
    bootstrapButton.dataset.locked = isBootstrapped ? "1" : "0";
    if (!isBootstrapped) {
        locationSummary.textContent = "Initialize the toolkit to load object positions.";
        renderLocationItems([]);
    }
    setBusy(false);
}

function setStatusBadge(label, tone = "") {
    statusBadge.textContent = label;
    statusBadge.className = `badge${tone ? ` ${tone}` : ""}`;
}

function applyStatus(status, options = {}) {
    const currentUrl = status?.currentUrl || "Unknown page";

    if (!status?.available) {
        setStatusBadge("Toolkit Not Found", "error");
        statusText.textContent = "Open the OPCloud page in the active tab so the toolkit can attach.";
        setEnabledWhenBootstrapped(false);
        if (!options.preserveLog) {
            setLog("Toolkit was not found on the active page.");
        }
        return;
    }

    if (status.bootstrapped) {
        setStatusBadge("Ready", "");
        statusText.textContent = "Toolkit is bootstrapped. Export and import actions are enabled.";
        setEnabledWhenBootstrapped(true);
        loadObjectLocations({preserveLog: true}).catch(() => {
        });
        if (!options.preserveLog) {
            setLog(`Connected to:\n${currentUrl}`);
        }
        return;
    }

    setStatusBadge("Needs Bootstrap", "warn");
    statusText.textContent = "Initialize the toolkit once for this tab before exporting or importing.";
    setEnabledWhenBootstrapped(false);
    if (!options.preserveLog) {
        setLog(`Toolkit injected but not bootstrapped yet.\n${currentUrl}`);
    }
}

function formatError(error) {
    return error?.message || String(error);
}

function getTimestampFileSuffix() {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate())
    ].join("") + "-" + [
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds())
    ].join("");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function formatNodeType(type) {
    if (type === "opm.Object") return "Object";
    if (type === "opm.Process") return "Process";
    return type || "Node";
}

function getNodeTypeTagClass(type) {
    if (type === "opm.Object") return "object";
    if (type === "opm.Process") return "process";
    return "";
}

function renderLocationItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        locationList.className = "location-list empty";
        locationList.innerHTML = "No visible objects or processes found in the current OPD.";
        return;
    }

    locationList.className = "location-list";
    locationList.innerHTML = items.map((item) => {
        const topTags = [];
        if (item.stateCount > 0) {
            topTags.push(`<span class="location-tag">${item.stateCount} state${item.stateCount === 1 ? "" : "s"}</span>`);
        }
        if (item.isSelected) {
            topTags.push('<span class="location-tag selected">Selected</span>');
        }
        const typeLabel = formatNodeType(item.type);
        const typeTagClass = getNodeTypeTagClass(item.type);

        return `
            <form class="location-card${item.isSelected ? " selected" : ""}" data-node-id="${escapeHtml(item.id)}">
                <div class="location-card-head">
                    <div>
                        <p class="location-card-title" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</p>
                    </div>
                    <div class="location-tags">${topTags.join("")}</div>
                </div>
                <div class="location-row">
                    <label class="location-name">
                        <button type="button" title="${escapeHtml(typeLabel)}">
                            <span class="location-tag ${typeTagClass}">${escapeHtml(typeLabel)}</span>
                        </button>
                    </label>
                    <label class="location-field">
                        <span>X</span>
                        <input name="x" type="number" step="1" value="${Number.isFinite(item.position?.x) ? item.position.x : ""}">
                    </label>
                    <label class="location-field">
                        <span>Y</span>
                        <input name="y" type="number" step="1" value="${Number.isFinite(item.position?.y) ? item.position.y : ""}">
                    </label>
                    <div class="location-actions">
                        <button type="submit">Apply</button>
                    </div>
                </div>
            </form>
        `;
    }).join("");
}

async function loadObjectLocations(options = {}) {
    const {preserveLog = false} = options;

    try {
        const result = await sendToPage("getObjectLocations");
        const currentOpdName = result?.report?.currentOpd?.name || "current OPD";
        const count = Array.isArray(result?.report?.items) ? result.report.items.length : 0;
        locationSummary.textContent = `Loaded ${count} visible object/process item${count === 1 ? "" : "s"} from ${currentOpdName}.`;
        renderLocationItems(result?.report?.items || []);
        if (!preserveLog) {
            setLog(`Loaded ${count} object/process positions from ${currentOpdName}.`);
        }
    } catch (error) {
        locationSummary.textContent = "Could not load object positions from the page.";
        renderLocationItems([]);
        if (!preserveLog) {
            setLog(`Location load failed.\n${formatError(error)}`);
        }
    }
}

async function updateNodeLocation(nodeId, x, y) {
    setBusyState(true, "Updating position...");
    setLog(`Updating node position...\n${nodeId}\n(${x}, ${y})`);
    try {
        const result = await sendToPage("setObjectLocation", {nodeId, x, y});
        const label = result?.report?.after?.label || nodeId;
        const position = result?.report?.after?.position || {x, y};
        await loadObjectLocations({preserveLog: true});
        setLog(`Position updated.\n${label}\n(${position.x}, ${position.y})`);
    } catch (error) {
        setLog(`Position update failed.\n${formatError(error)}`);
    } finally {
        setBusyState(false);
    }
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) {
        throw new Error("No active tab found");
    }
    return tab;
}

function isSupportedTab(tab) {
    if (!tab?.url) return false;
    try {
        const url = new URL(tab.url);
        return url.origin === SUPPORTED_ORIGIN;
    } catch {
        return false;
    }
}

async function sendToPage(action, payload = {}) {
    const tab = await getActiveTab();
    if (!isSupportedTab(tab)) {
        throw new Error(`This extension only works on ${SUPPORTED_ORIGIN}/`);
    }

    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, {
            type: "opcloud-toolkit",
            action,
            payload
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response) {
                reject(new Error("No response from page"));
                return;
            }
            if (!response.ok) {
                reject(new Error(response.error?.message || "Request failed"));
                return;
            }
            resolve(response.result);
        });
    });
}

async function refreshStatus(options = {}) {
    const {
        preserveLog = false,
        keepBusyState = false,
        busyLabel = "Checking status..."
    } = options;

    if (!keepBusyState) {
        setBusyState(true, busyLabel);
    }

    try {
        const tab = await getActiveTab();
        if (!isSupportedTab(tab)) {
            disableForUnsupportedSite(`This extension only works on ${SUPPORTED_ORIGIN}/`);
            if (!preserveLog) {
                setLog(`Open OPCloud Sandbox in the active tab:\n${SUPPORTED_ORIGIN}/`);
            }
            return;
        }

        const result = await sendToPage("status");
        applyStatus(result.status, {preserveLog});
    } catch (error) {
        setStatusBadge("Page Unreachable", "error");
        statusText.textContent = "Open an OPCloud tab, then refresh this popup.";
        setEnabledWhenBootstrapped(false);
        if (!preserveLog) {
            setLog(formatError(error));
        }
    } finally {
        if (!keepBusyState) {
            setBusyState(false);
        }
    }
}

async function settleAndRefreshStatus(successLog, delayMs = 800) {
    if (successLog) {
        setLog(successLog);
    }
    await sleep(delayMs);
    await refreshStatus({
        preserveLog: true,
        keepBusyState: true,
        busyLabel: "Refreshing status..."
    });
    setBusyState(false);
}

async function bootstrapToolkit() {
    setBusyState(true, "Bootstrapping...");
    setLog("Bootstrapping toolkit...");
    try {
        const result = await sendToPage("bootstrap");
        applyStatus(result.status, {preserveLog: true});
        await settleAndRefreshStatus(`Bootstrap complete.\n${JSON.stringify(result.report, null, 2)}`);
    } catch (error) {
        setLog(`Bootstrap failed.\n${formatError(error)}`);
        await sleep(800);
        await refreshStatus({
            preserveLog: true,
            keepBusyState: true,
            busyLabel: "Refreshing status..."
        });
        setBusyState(false);
    }
}

async function exportTree() {
    return sendToPage("exportTree");
}

async function downloadExport() {
    setBusyState(true, "Exporting...");
    setLog("Exporting OPD tree...");
    try {
        const result = await exportTree();
        const jsonText = JSON.stringify(result.data, null, 2);
        const blob = new Blob([jsonText], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const filename = `opcloud-export-${getTimestampFileSuffix()}.json`;

        await chrome.downloads.download({
            url,
            filename,
            saveAs: true
        });

        URL.revokeObjectURL(url);
        setLog(`Export created.\nFile: ${filename}\nBytes: ${jsonText.length}`);
    } catch (error) {
        setLog(`Export failed.\n${formatError(error)}`);
    } finally {
        setBusyState(false);
    }
}

async function copyExport() {
    setBusyState(true, "Exporting...");
    setLog("Exporting OPD tree...");
    try {
        const result = await exportTree();
        const jsonText = JSON.stringify(result.data, null, 2);
        await navigator.clipboard.writeText(jsonText);
        setLog(`Export copied to clipboard.\nBytes: ${jsonText.length}`);
    } catch (error) {
        setLog(`Copy failed.\n${formatError(error)}`);
    } finally {
        setBusyState(false);
    }
}

function parseJsonText(text) {
    if (!text || !text.trim()) {
        throw new Error("No JSON content provided");
    }
    return JSON.parse(text);
}

async function importParsedData(data, sourceLabel) {
    setBusyState(true, "Importing...");
    setLog(`Importing ${sourceLabel}...`);
    try {
        const result = await sendToPage("importTree", {data});
        applyStatus(result.status, {preserveLog: true});
        await settleAndRefreshStatus(`Import complete.\n${JSON.stringify(result.report, null, 2)}`);
    } catch (error) {
        setLog(`Import failed.\n${formatError(error)}`);
        await sleep(800);
        await refreshStatus({
            preserveLog: true,
            keepBusyState: true,
            busyLabel: "Refreshing status..."
        });
        setBusyState(false);
    }
}

async function importFromText() {
    try {
        const data = parseJsonText(jsonInput.value);
        await importParsedData(data, "pasted JSON");
    } catch (error) {
        setLog(`Paste import failed.\n${formatError(error)}`);
    }
}

async function importFromFile() {
    const file = fileInput.files?.[0];
    if (!file) {
        setLog("Choose a JSON file first.");
        return;
    }

    try {
        const text = await file.text();
        const data = parseJsonText(text);
        await importParsedData(data, `file "${file.name}"`);
    } catch (error) {
        setLog(`File import failed.\n${formatError(error)}`);
    }
}

bootstrapButton.addEventListener("click", bootstrapToolkit);
refreshStatusButton.addEventListener("click", refreshStatus);
downloadExportButton.addEventListener("click", downloadExport);
copyExportButton.addEventListener("click", copyExport);
refreshLocationsButton.addEventListener("click", async () => {
    setBusyState(true, "Loading positions...");
    try {
        await loadObjectLocations();
    } finally {
        setBusyState(false);
    }
});
importTextButton.addEventListener("click", importFromText);
importFileButton.addEventListener("click", importFromFile);
clearTextButton.addEventListener("click", () => {
    jsonInput.value = "";
    setLog("Pasted JSON cleared.");
});
locationList.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();

    const nodeId = form.dataset.nodeId;
    const xInput = form.elements.namedItem("x");
    const yInput = form.elements.namedItem("y");
    const x = Number(xInput?.value);
    const y = Number(yInput?.value);
    if (!nodeId) {
        setLog("Missing node id for location update.");
        return;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        setLog("Position update failed.\nX and Y must be valid numbers.");
        return;
    }

    await updateNodeLocation(nodeId, x, y);
});

refreshStatus();
