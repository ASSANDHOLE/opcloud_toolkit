(function () {
    if (window.__opcloudToolkitPageBridgeLoaded) {
        return;
    }
    window.__opcloudToolkitPageBridgeLoaded = true;

    const REQUEST_SOURCE = "opcloud-toolkit-extension";
    const RESPONSE_SOURCE = "opcloud-toolkit-page";

    function serializeError(error) {
        return {
            message: error?.message || String(error),
            stack: error?.stack || null
        };
    }

    function toJsonSafe(value) {
        if (value == null) return value;

        const t = typeof value;
        if (t === "string" || t === "number" || t === "boolean") {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map(toJsonSafe);
        }

        if (t === "function") {
            return `[Function ${value.name || "anonymous"}]`;
        }

        if (t !== "object") {
            return String(value);
        }

        const ctorName = value?.constructor?.name || "";
        if (
            ctorName &&
            ctorName !== "Object" &&
            ctorName !== "Array" &&
            !(value instanceof Date)
        ) {
            return `[${ctorName}]`;
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = toJsonSafe(item);
        }
        return out;
    }

    function getApi() {
        return window.__opcloudSingleBoot || null;
    }

    function getStatus() {
        const api = getApi();
        const boot = api?.BOOT || null;
        const hasInit = !!boot?.capturedUiSeed?.init;
        const hasObjectCtor = !!boot?.bootConstructors?.object;
        const hasProcessCtor = !!boot?.bootConstructors?.process;
        const bootstrapped = !!boot?.bootstrappedOnce && hasInit && hasObjectCtor && hasProcessCtor;

        return {
            available: !!api,
            bootstrapped,
            hasInit,
            hasObjectCtor,
            hasProcessCtor,
            currentUrl: window.location.href
        };
    }

    function requireApi() {
        const api = getApi();
        if (!api) {
            throw new Error("Toolkit not found on this page");
        }
        return api;
    }

    function requireBootstrapped(api) {
        const status = getStatus();
        if (!status.bootstrapped) {
            throw new Error("Toolkit is not bootstrapped yet");
        }
        return api;
    }

    async function handleAction(action, payload) {
        if (action === "status") {
            return {
                status: getStatus()
            };
        }

        const api = requireApi();

        if (action === "bootstrap") {
            const report = await api.bootstrapRuntimeOnce();
            return {
                status: getStatus(),
                report: toJsonSafe(report)
            };
        }

        if (action === "exportTree") {
            requireBootstrapped(api);
            const data = await api.exportEntireOpdTree();
            return {
                status: getStatus(),
                data
            };
        }

        if (action === "exportCurrent") {
            requireBootstrapped(api);
            const data = await api.exportCurrentOpdV2();
            return {
                status: getStatus(),
                data
            };
        }

        if (action === "importTree") {
            requireBootstrapped(api);
            const data = payload?.data ?? null;
            if (!data || typeof data !== "object") {
                throw new Error("Import payload must include a parsed data object");
            }
            const report = await api.importEntireOpdTreeAio(data);
            return {
                status: getStatus(),
                report
            };
        }

        if (action === "getObjectLocations") {
            requireBootstrapped(api);
            const report = await api.getCurrentOpdNodeLocations();
            return {
                status: getStatus(),
                report
            };
        }

        if (action === "setObjectLocation") {
            requireBootstrapped(api);
            const nodeId = payload?.nodeId ?? null;
            const x = payload?.x;
            const y = payload?.y;
            const report = await api.setNodeLocationAio(nodeId, {x, y});
            return {
                status: getStatus(),
                report
            };
        }

        throw new Error(`Unsupported action: ${action}`);
    }

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== REQUEST_SOURCE || !data.requestId) return;

        try {
            const result = await handleAction(data.action, data.payload || {});
            window.postMessage({
                source: RESPONSE_SOURCE,
                requestId: data.requestId,
                ok: true,
                result
            }, "*");
        } catch (error) {
            window.postMessage({
                source: RESPONSE_SOURCE,
                requestId: data.requestId,
                ok: false,
                error: serializeError(error)
            }, "*");
        }
    });
})();
