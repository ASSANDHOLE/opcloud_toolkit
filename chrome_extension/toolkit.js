(async function () {
    if (window.__opcloudSingleBootToolkitLoaded) {
        console.log("OPCloud single-boot toolkit already loaded");
        return;
    }
    window.__opcloudSingleBootToolkitLoaded = true;

    const BOOT = {
        created: {
            object: null,
            process: null
        },
        cachedGraph: null,
        capturedUiSeed: {
            obj: null,
            visual: null,
            init: null,
            calls: 0
        },
        bootstrappedOnce: false,
        bootConstructors: {
            object: null,
            process: null
        },
        logs: []
    };

    function log(kind, payload) {
        const item = {t: Date.now(), kind, payload};
        BOOT.logs.push(item);
        console.log(`[OPSINGLE] ${kind}`, payload);
        return item;
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /* -----------------------------
       Stable canvas / model helpers
    ------------------------------*/

    function getMainSvg() {
        return [...document.querySelectorAll("svg")]
            .sort((a, b) =>
                (b.getBoundingClientRect().width * b.getBoundingClientRect().height) -
                (a.getBoundingClientRect().width * a.getBoundingClientRect().height)
            )[0];
    }

    function getHiddenJqData(el) {
        const key = Object.getOwnPropertyNames(el).find(k => k.startsWith("jQuery"));
        return key ? el[key] : null;
    }

    function getCellView(el) {
        const data = getHiddenJqData(el);
        if (!data) return null;

        for (const v of Object.values(data)) {
            if (v && typeof v === "object" && v.view) return v.view;
        }

        return data.view || null;
    }

    function isOnMainCanvas(el, mainSvg = getMainSvg()) {
        return !!el && el.farthestViewportElement === mainSvg;
    }

    function getMainCells(selector) {
        const mainSvg = getMainSvg();
        return [...document.querySelectorAll(selector)]
            .filter(el => isOnMainCanvas(el, mainSvg));
    }

    function getModelFromElement(el) {
        const view = getCellView(el);
        if (!view?.model) {
            throw new Error("Could not resolve model from element");
        }
        return view.model;
    }

    function getMainElementModels() {
        return getMainCells(".joint-element").map(el => getModelFromElement(el));
    }

    function getNodeType(model) {
        return model?.get?.("type") || model?.toJSON?.()?.type || null;
    }

    function getLabelFromModel(model) {
        const j = model?.toJSON ? model.toJSON() : model;
        return j?.attrs?.text?.textWrap?.text ?? null;
    }

    function setLabelOnModel(model, label) {
        model.attr("text/textWrap/text", label);
    }

    function getIdFromModel(model) {
        return model?.get?.("id") || model?.id || model?.toJSON?.()?.id || null;
    }

    function getPositionFromModel(model) {
        const j = model?.toJSON ? model.toJSON() : model;
        return j?.position || null;
    }

    function getStateChildren(model) {
        return (model?.getEmbeddedCells?.() || []).filter(c => getNodeType(c) === "opm.State");
    }

    function countStates(model) {
        return getStateChildren(model).length;
    }

    function summarizeStates(model) {
        return getStateChildren(model).map(s => {
            const j = s?.toJSON ? s.toJSON() : {};
            return {
                id: getIdFromModel(s),
                label: getLabelFromModel(s),
                parent: j?.parent ?? null,
                position: j?.position ?? null,
                size: j?.size ?? null
            };
        });
    }

    function getEmbeddedThingChildren(model, {deep = true} = {}) {
        const cells = model?.getEmbeddedCells?.(deep ? {deep: true} : undefined) || [];
        return cells.filter(c => {
            const t = getNodeType(c);
            return t === "opm.Object" || t === "opm.Process" || t === "opm.State";
        });
    }

    function moveAndKeepChildrenPositionByPosition(model, newX, newY) {
        if (!model) throw new Error("model is required");

        const oldPos = model.get?.("position");
        const thisSize = model.get?.("size");
        if (!oldPos || !thisSize) {
            throw new Error("model has no valid position/size");
        }

        model.position(newX, newY, {});
        const thisPos = {x: newX, y: newY};

        for (const cell of getEmbeddedThingChildren(model, {deep: true})) {
            const cellPos = cell.get?.("position");
            const cellSize = cell.get?.("size");
            if (!cellPos || !cellSize) continue;

            const relativeX = (cellPos.x - oldPos.x + cellSize.width / 2) / thisSize.width;
            const relativeY = (cellPos.y - oldPos.y + cellSize.height / 2) / thisSize.height;
            const newXPos = relativeX * thisSize.width + thisPos.x - cellSize.width / 2;
            const newYPos = relativeY * thisSize.height + thisPos.y - cellSize.height / 2;
            cell.position(newXPos, newYPos, {});
        }

        return {
            id: getIdFromModel(model),
            label: getLabelFromModel(model),
            position: getPositionFromModel(model),
            childCount: getEmbeddedThingChildren(model, {deep: true}).length
        };
    }

    function fitObjectToEmbeddedStatesWithDefaults(
        obj,
        {
            padLeft = 10,
            padRight = 10,
            padTop = 40,
            padBottom = 10,
            eps = 2
        } = {}
    ) {
        if (!obj) throw new Error("obj is required");

        const states = getStateChildren(obj);
        if (!states.length) {
            return {
                changed: false,
                reason: "no embedded states"
            };
        }

        const objPos = obj.get?.("position");
        const objSize = obj.get?.("size");
        if (!objPos || !objSize) {
            throw new Error("object has no valid position/size");
        }

        let minLeft = Infinity;
        let minTop = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;

        for (const st of states) {
            const stPos = st.get?.("position");
            const stSize = st.get?.("size");
            if (!stPos || !stSize) continue;

            const left = stPos.x;
            const top = stPos.y;
            const right = stPos.x + stSize.width;
            const bottom = stPos.y + stSize.height;

            if (left < minLeft) minLeft = left;
            if (top < minTop) minTop = top;
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
        }

        if (!isFinite(minLeft) || !isFinite(minTop) || !isFinite(maxRight) || !isFinite(maxBottom)) {
            return {
                changed: false,
                reason: "could not derive state bounds"
            };
        }

        const desiredX = minLeft - padLeft;
        const desiredY = minTop - padTop;
        const desiredWidth = (maxRight + padRight) - desiredX;
        const desiredHeight = (maxBottom + padBottom) - desiredY;

        const oldX = objPos.x;
        const oldY = objPos.y;
        const oldWidth = objSize.width;
        const oldHeight = objSize.height;

        const closeEnough =
            Math.abs(desiredX - oldX) <= eps &&
            Math.abs(desiredY - oldY) <= eps &&
            Math.abs(desiredWidth - oldWidth) <= eps &&
            Math.abs(desiredHeight - oldHeight) <= eps;

        if (closeEnough) {
            return {
                changed: false,
                reason: "within tolerance",
                old: {x: oldX, y: oldY, width: oldWidth, height: oldHeight},
                desired: {x: desiredX, y: desiredY, width: desiredWidth, height: desiredHeight}
            };
        }

        moveAndKeepChildrenPositionByPosition(obj, desiredX, desiredY);
        obj.resize(desiredWidth, desiredHeight, {});

        return {
            changed: true,
            old: {x: oldX, y: oldY, width: oldWidth, height: oldHeight},
            next: {x: desiredX, y: desiredY, width: desiredWidth, height: desiredHeight},
            stateCount: states.length
        };
    }

    function getStatesByVisualOrder(model) {
        return getStateChildren(model)
            .slice()
            .sort((a, b) => {
                const pa = getPositionFromModel(a);
                const pb = getPositionFromModel(b);
                const ay = pa?.y ?? 0;
                const by = pb?.y ?? 0;
                if (ay !== by) return ay - by;
                const ax = pa?.x ?? 0;
                const bx = pb?.x ?? 0;
                return ax - bx;
            });
    }

    function findObjectByLabel(label) {
        return getMainElementModels().find(
            m => getNodeType(m) === "opm.Object" && getLabelFromModel(m) === label
        ) || null;
    }

    function mapKindToType(kind) {
        if (kind === "object") return "opm.Object";
        if (kind === "process") return "opm.Process";
        return null;
    }

    function getExistingModelByKind(kind) {
        const wantedType = mapKindToType(kind);
        if (!wantedType) return null;
        return getMainElementModels().find(m => getNodeType(m) === wantedType) || null;
    }

    function findNewestCreatedModel(kind, beforeIds) {
        const wantedType = mapKindToType(kind);
        const models = getMainElementModels();
        const candidates = models.filter(m => {
            const id = m.get?.("id");
            return getNodeType(m) === wantedType && !beforeIds.has(id);
        });
        return candidates[candidates.length - 1] || null;
    }

    function getDomForModel(model) {
        const wantedId = getIdFromModel(model);
        return getMainCells(".joint-element, .joint-link").find(el => {
            const view = getCellView(el);
            return view?.model && getIdFromModel(view.model) === wantedId;
        }) || null;
    }

    function getObjectDom(model) {
        return getDomForModel(model);
    }

    /* -----------------------------
       Stencil / target helpers
    ------------------------------*/

    function getStencilButton(kind) {
        if (kind === "object") return document.querySelector("#object");
        if (kind === "process") return document.querySelector("#process");
        return null;
    }

    function getStencilDragSource(kind) {
        const btn = getStencilButton(kind);
        if (!btn) return null;
        return btn.closest("[draggable='true']");
    }

    function getFloatingStencilGhosts() {
        return [
            document.querySelector("#objectDrag"),
            document.querySelector("#processDrag")
        ].filter(Boolean);
    }

    function getLikelyDropTargets() {
        return [...document.querySelectorAll("*")].filter(el => {
            const cls = el.className;
            return typeof cls === "string" && (
                cls.includes("paper-scroller-background") ||
                cls.includes("joint-paper-scroller") ||
                cls.includes("joint-paper")
            );
        });
    }

    function chooseDropTarget(targetIndex = 0) {
        const targets = getLikelyDropTargets()
            .sort((a, b) =>
                b.getBoundingClientRect().width * b.getBoundingClientRect().height -
                a.getBoundingClientRect().width * a.getBoundingClientRect().height
            );
        return targets[targetIndex] || null;
    }

    function getToolbarButtons() {
        const roots = [...document.querySelectorAll(".stateArrangeIcons")];
        return roots.flatMap(root =>
            [...root.querySelectorAll("a.button, a.mat-mdc-tooltip-trigger, button")]
        );
    }

    /* -----------------------------
       Event helpers
    ------------------------------*/

    function makeDataTransfer(kind) {
        const dt = new DataTransfer();
        try {
            dt.setData("text/plain", kind);
        } catch {
        }
        try {
            dt.setData("text/opcloud", kind);
        } catch {
        }
        try {
            dt.setData("application/opcloud", JSON.stringify({type: kind}));
        } catch {
        }
        return dt;
    }

    function fireDragEvent(type, el, dt, x, y) {
        const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt
        });
        el.dispatchEvent(ev);
        return ev;
    }

    function fireMouseEvent(type, el, x, y, buttons = 1) {
        const ev = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons
        });
        el.dispatchEvent(ev);
        return ev;
    }

    function dispatchMouseSequence(el) {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);

        const down = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1
        };

        const up = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 0
        };

        try {
            el.dispatchEvent(new PointerEvent("pointerdown", down));
        } catch {
        }
        el.dispatchEvent(new MouseEvent("mousedown", down));
        try {
            el.dispatchEvent(new PointerEvent("pointerup", up));
        } catch {
        }
        el.dispatchEvent(new MouseEvent("mouseup", up));
        el.dispatchEvent(new MouseEvent("click", up));

        return {x, y};
    }

    function cleanupGhostUi() {
        for (const ghost of getFloatingStencilGhosts()) {
            try {
                ghost.style.top = "-800px";
                ghost.style.left = "-800px";
                ghost.style.transform = "";
                ghost.style.pointerEvents = "none";
            } catch {
            }
        }

        try {
            document.body.style.cursor = "";
        } catch {
        }
        try {
            document.documentElement.style.cursor = "";
        } catch {
        }

        const active = document.activeElement;
        try {
            active?.blur?.();
        } catch {
        }
    }

    /* -----------------------------
       Init / real UI seed capture
    ------------------------------*/

    function looksLikeInitRappidService(x) {
        if (!x || typeof x !== "object") return false;
        if (x.constructor?.name === "InitRappidService") return true;
        return !!(
            x.paper &&
            x.graph &&
            x.paperScroller &&
            x.selection &&
            x.graphService &&
            x.oplService
        );
    }

    function installUiSeedCaptureOn(model) {
        if (!model || typeof model.addStateAction !== "function") {
            throw new Error("Target model does not expose addStateAction");
        }
        if (model.__singleBootUiSeedCaptureInstalled) return;

        const orig = model.addStateAction;
        model.addStateAction = function (...args) {
            const visual = args[0];
            const init = args[1];

            BOOT.capturedUiSeed.obj = this;
            BOOT.capturedUiSeed.visual = visual || null;
            BOOT.capturedUiSeed.init = init || null;
            BOOT.capturedUiSeed.calls += 1;

            log("capturedUiSeed", {
                objId: getIdFromModel(this),
                objLabel: getLabelFromModel(this),
                visualCtor: visual?.constructor?.name ?? null,
                initCtor: init?.constructor?.name ?? null,
                initLooksRight: looksLikeInitRappidService(init)
            });

            return orig.apply(this, args);
        };

        model.__singleBootUiSeedCaptureInstalled = true;
        model.__singleBootUiSeedCaptureOrig = orig;
    }

    async function captureUiSeedFromObject(model, {
        selectDelayMs = 250,
        toolbarDelayMs = 350,
        toolbarButtonIndex = 0
    } = {}) {
        if (!model) throw new Error("captureUiSeedFromObject requires a model");

        installUiSeedCaptureOn(model);

        const dom = getObjectDom(model);
        if (!dom) throw new Error("Could not find object DOM for UI seed capture");

        log("captureUiSeed.clickObject", {
            id: getIdFromModel(model),
            label: getLabelFromModel(model),
            click: dispatchMouseSequence(dom)
        });

        await sleep(selectDelayMs);

        const buttons = getToolbarButtons();
        if (!buttons.length) {
            throw new Error("No toolbar buttons found after synthetic selection");
        }

        const btn = buttons[toolbarButtonIndex] || buttons[0];
        log("captureUiSeed.clickToolbar", {
            toolbarButtons: buttons.length,
            toolbarButtonIndex,
            click: dispatchMouseSequence(btn)
        });

        await sleep(toolbarDelayMs);

        const init = BOOT.capturedUiSeed.init;
        BOOT.cachedGraph = init?.graph || BOOT.cachedGraph;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("Failed to capture a valid InitRappidService from synthetic toolbar click");
        }

        return {
            obj: BOOT.capturedUiSeed.obj,
            visual: BOOT.capturedUiSeed.visual,
            init: BOOT.capturedUiSeed.init,
            calls: BOOT.capturedUiSeed.calls
        };
    }

    async function ensureUiSeedCaptured() {
        if (looksLikeInitRappidService(BOOT.capturedUiSeed.init) && BOOT.capturedUiSeed.visual) {
            return {
                obj: BOOT.capturedUiSeed.obj,
                visual: BOOT.capturedUiSeed.visual,
                init: BOOT.capturedUiSeed.init,
                calls: BOOT.capturedUiSeed.calls
            };
        }

        let bootObject = BOOT.created.object;
        if (!bootObject) {
            bootObject = await createSingleObjectIfMissing();
            if (!bootObject) {
                bootObject = getExistingModelByKind("object");
            }
        }
        if (!bootObject) {
            throw new Error("Could not create/find boot object for UI seed capture");
        }

        if (!getLabelFromModel(bootObject)) {
            setLabelOnModel(bootObject, "Object 1");
        }

        return captureUiSeedFromObject(bootObject);
    }

    /* -----------------------------
       Single-create bootstrap
    ------------------------------*/

    async function createSingleKindIfMissing(kind, {
        targetIndex = 0,
        rx = 0.5,
        ry = 0.4,
        delayMs = 120,
        requireCanvasEmptyOfKind = true
    } = {}) {
        if (requireCanvasEmptyOfKind) {
            const existing = getExistingModelByKind(kind);
            if (existing) {
                log("createSingleKindIfMissing.alreadyExists", {
                    kind,
                    id: existing.get?.("id"),
                    label: getLabelFromModel(existing)
                });
                return null;
            }
        }

        const button = getStencilButton(kind);
        const dragSource = getStencilDragSource(kind);
        const target = chooseDropTarget(targetIndex);

        if (!button) {
            throw new Error(`Could not find stencil button for kind: ${kind}`);
        }
        if (!dragSource) {
            throw new Error(`Could not find draggable stencil source for kind: ${kind}`);
        }
        if (!target) {
            throw new Error("Could not find canvas target");
        }

        const beforeIds = new Set(getMainElementModels().map(m => m.get?.("id")));
        const rect = target.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width * rx);
        const y = Math.round(rect.top + rect.height * ry);
        const dt = makeDataTransfer(kind);

        log("createSingleKindIfMissing.start", {
            kind,
            targetClass: target.className,
            x,
            y,
            requireCanvasEmptyOfKind
        });

        fireMouseEvent("mousedown", button, x, y, 1);
        await sleep(10);

        fireDragEvent("dragstart", dragSource, dt, x, y);
        await sleep(20);

        fireMouseEvent("mousemove", window, x, y, 1);
        await sleep(20);

        fireMouseEvent("mouseup", window, x, y, 0);
        await sleep(delayMs);

        cleanupGhostUi();

        const created = findNewestCreatedModel(kind, beforeIds);
        if (!created) {
            throw new Error(`Single bootstrap did not create a ${kind}`);
        }

        BOOT.created[kind] = created;
        BOOT.cachedGraph = created.graph || created.collection?.graph || created.collection || BOOT.cachedGraph;

        log("createSingleKindIfMissing.created", {
            kind,
            id: created.get?.("id"),
            label: getLabelFromModel(created),
            type: getNodeType(created)
        });

        if (kind === "object") {
            try {
                await ensureUiSeedCaptured();
            } catch (e) {
                log("ensureUiSeedCaptured.failed", {error: String(e)});
            }
        }

        return created;
    }

    async function createSingleObjectIfMissing(opts = {}) {
        return createSingleKindIfMissing("object", opts);
    }

    async function createSingleObjectFresh(opts = {}) {
        return createSingleKindIfMissing("object", {
            ...opts,
            requireCanvasEmptyOfKind: false
        });
    }

    async function createSingleProcessFresh(opts = {}) {
        return createSingleKindIfMissing("process", {
            ...opts,
            requireCanvasEmptyOfKind: false
        });
    }

    /* -----------------------------
       State helpers
    ------------------------------*/

    function ensureNamedStateInputs(model, names) {
        if (!model) throw new Error("State helper requires a target model");
        if (getNodeType(model) !== "opm.Object") {
            throw new Error("States can only be added to opm.Object models");
        }
        if (!Array.isArray(names) || !names.length) {
            throw new Error("State names must be a non-empty array");
        }

        const existing = countStates(model);
        if (existing === 0) {
            if (names.length !== 2) {
                throw new Error("Target object has no states yet; provide exactly two names for the first add");
            }
        } else {
            if (names.length !== 1) {
                throw new Error("Target object already has states; provide exactly one name");
            }
        }
    }

    function renameStatesByVisualOrder(model, names) {
        const states = getStatesByVisualOrder(model);

        if (states.length !== names.length) {
            throw new Error("renameStatesByVisualOrder requires exactly one name per state");
        }

        const renamed = [];
        for (let i = 0; i < names.length; i++) {
            const state = states[i];
            const name = names[i];
            setLabelOnModel(state, name);
            renamed.push({
                id: getIdFromModel(state),
                label: getLabelFromModel(state)
            });
        }

        return renamed;
    }

    function syncStateNameBindings(model, names) {
        const states = getStatesByVisualOrder(model);
        if (states.length !== names.length) {
            throw new Error("syncStateNameBindings requires exactly one name per state");
        }

        const visual = model.getVisual?.() || null;
        const logical = visual?.logicalElement || null;
        const stateIds = states.map(s => getIdFromModel(s));

        const visualStates = Array.isArray(visual?.states) ? visual.states : null;
        const logicalStates = Array.isArray(logical?.states_) ? logical.states_ : (
            typeof logical?.states === "function" && Array.isArray(logical.states()) ? logical.states() : null
        );

        if (visualStates) {
            const orderedVisualStates = stateIds.map(id => visualStates.find(v => v?.id === id)).filter(Boolean);
            if (orderedVisualStates.length === names.length) {
                orderedVisualStates.forEach((s, i) => {
                    try {
                        s.text = names[i];
                    } catch {
                    }
                    try {
                        s.label = names[i];
                    } catch {
                    }
                    try {
                        s.name = names[i];
                    } catch {
                    }
                });
            } else {
                visualStates.slice(0, names.length).forEach((s, i) => {
                    try {
                        s.text = names[i];
                    } catch {
                    }
                    try {
                        s.label = names[i];
                    } catch {
                    }
                    try {
                        s.name = names[i];
                    } catch {
                    }
                });
            }
        }

        if (logicalStates) {
            logicalStates.slice(0, names.length).forEach((s, i) => {
                try {
                    s.text = names[i];
                } catch {
                }
                try {
                    s.label = names[i];
                } catch {
                }
                try {
                    s.name = names[i];
                } catch {
                }
            });
        }

        return {
            stateIds,
            names,
            visualStates: visualStates ? visualStates.length : null,
            logicalStates: logicalStates ? logicalStates.length : null
        };
    }

    async function addStates(target, names) {
        await ensureUiSeedCaptured();

        const model = typeof target === "string" ? findObjectByLabel(target) : target;
        if (!model) throw new Error("Target object not found");

        ensureNamedStateInputs(model, names);

        const visual = model.getVisual?.();
        if (!visual) throw new Error("Target object has no visual object");

        const init = BOOT.capturedUiSeed.init;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const before = countStates(refreshModelRef(model) || model);
        model.addStateAction(visual, init, false);
        const refreshed = refreshModelRef(model) || model;
        const after = countStates(refreshed);

        const report = {
            targetId: getIdFromModel(refreshed),
            targetLabel: getLabelFromModel(refreshed),
            before,
            after,
            added: after - before,
            states: summarizeStates(refreshed)
        };

        log("addStates", report);
        return report;
    }

    async function updateStatesAio(target, names, {
        removeType = 1,
        deleteDelayMs = 0,
        preferDirectRemove = true
    } = {}) {
        await ensureUiSeedCaptured();

        let model = typeof target === "string" ? findObjectByLabel(target) : target;
        if (!model) throw new Error("Target object not found");
        if (getNodeType(model) !== "opm.Object") {
            throw new Error("States can only be updated on opm.Object models");
        }
        if (!Array.isArray(names) || names.length < 2) {
            throw new Error("updateStatesAio requires a state list with at least 2 names");
        }
        if (names.some(x => typeof x !== "string" || !x.trim())) {
            throw new Error("All state names must be non-empty strings");
        }

        const desiredNames = names.map(x => x.trim());
        model = refreshModelRef(model) || model;
        const beforeStates = summarizeStates(model);

        let currentCount = countStates(model);
        while (currentCount < desiredNames.length) {
            if (currentCount === 0) {
                await addStates(model, [desiredNames[0], desiredNames[1]]);
            } else {
                await addStates(model, [desiredNames[currentCount]]);
            }
            model = refreshModelRef(model) || model;
            currentCount = countStates(model);
        }

        while (currentCount > desiredNames.length) {
            model = refreshModelRef(model) || model;
            const ordered = getStatesByVisualOrder(model);
            const victim = ordered[ordered.length - 1];
            if (!victim) break;
            await deleteNodeAio(victim, {
                removeType,
                deleteDelayMs,
                preferDirectRemove
            });
            model = refreshModelRef(model) || model;
            currentCount = countStates(model);
        }

        model = refreshModelRef(model) || model;
        const orderedStates = getStatesByVisualOrder(model);
        if (orderedStates.length !== desiredNames.length) {
            throw new Error(`State count mismatch before rename: runtime=${orderedStates.length}, desired=${desiredNames.length}`);
        }

        const renameReports = [];
        for (let i = 0; i < desiredNames.length; i++) {
            const stateModel = refreshModelRef(orderedStates[i]) || orderedStates[i];
            const currentLabel = getLabelFromModel(stateModel);
            const desiredLabel = desiredNames[i];
            if (currentLabel === desiredLabel) continue;
            const rep = await renameNodeAio(stateModel, desiredLabel, {onExisting: "rename"});
            renameReports.push(rep);
            model = refreshModelRef(model) || model;
        }

        model = refreshModelRef(model) || model;
        const afterStates = summarizeStates(model);

        const report = {
            targetId: getIdFromModel(model),
            targetLabel: getLabelFromModel(model),
            requestedNames: desiredNames,
            beforeCount: beforeStates.length,
            afterCount: afterStates.length,
            renameReports,
            beforeStates,
            afterStates
        };

        log("updateStatesAio", report);
        return report;
    }

    function parseEssenceSpec(spec) {
        if (!spec) throw new Error("Essence spec is required");

        if (typeof spec === "object") {
            const essence = spec.essence;
            const affiliation = spec.affiliation;
            if ((essence !== 0 && essence !== 1) || (affiliation !== 0 && affiliation !== 1)) {
                throw new Error("Essence object must use numeric essence/affiliation values (0 or 1)");
            }
            return {essence, affiliation};
        }

        const key = String(spec).trim().toLowerCase();
        const map = {
            "systemic+physical": {essence: 0, affiliation: 0},
            "systemic physical": {essence: 0, affiliation: 0},
            "physical+systemic": {essence: 0, affiliation: 0},
            "physical systemic": {essence: 0, affiliation: 0},
            "systemic+informatical": {essence: 1, affiliation: 0},
            "systemic informatical": {essence: 1, affiliation: 0},
            "informatical+systemic": {essence: 1, affiliation: 0},
            "informatical systemic": {essence: 1, affiliation: 0},
            "environmental+physical": {essence: 0, affiliation: 1},
            "environmental physical": {essence: 0, affiliation: 1},
            "physical+environmental": {essence: 0, affiliation: 1},
            "physical environmental": {essence: 0, affiliation: 1},
            "environmental+informatical": {essence: 1, affiliation: 1},
            "environmental informatical": {essence: 1, affiliation: 1},
            "informatical+environmental": {essence: 1, affiliation: 1},
            "informatical environmental": {essence: 1, affiliation: 1}
        };

        const out = map[key];
        if (!out) throw new Error(`Unsupported essence spec: ${spec}`);
        return out;
    }

    async function renameNodeAio(target, newLabel, {
        onExisting = "useExisting"
    } = {}) {
        await ensureUiSeedCaptured();

        const model = typeof target === "string" ? findAnyModelByLabel(target) : target;
        if (!model) throw new Error("Target node not found");
        if (typeof newLabel !== "string" || !newLabel.trim()) {
            throw new Error("New label must be a non-empty string");
        }

        const visual = model.getVisual?.();
        const logical = visual?.logicalElement;
        const init = BOOT.capturedUiSeed.init;

        if (!visual) throw new Error("Target node has no visual object");
        if (!logical) throw new Error("Target node has no logical element");
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const value = newLabel.trim();
        const before = {
            attrLabel: getLabelFromModel(model),
            logicalText: logical?.text ?? null,
            logicalTextForListLogical: logical?.textForListLogical ?? null,
            logicalLid: logical?.lid ?? null
        };

        const existence = typeof logical?.opmModel?.checkNameExistence === "function"
            ? logical.opmModel.checkNameExistence(logical, value)
            : null;

        if (existence?.value) {
            if (onExisting !== "useExisting") {
                const report = {
                    targetId: getIdFromModel(model),
                    targetType: getNodeType(model),
                    action: "collision",
                    requestedLabel: value,
                    existingLogicalLid: existence?.exist?.lid ?? null,
                    before,
                    after: before
                };
                log("renameNodeAio", report);
                return report;
            }

            logical.opmModel.logForUndo?.("Rename thing to existing");
            logical.opmModel.moveVisualsBetweenLogicals(logical, existence.exist);
            init.graphService?.renderGraph?.(init.opmModel.currentOpd, init, null, false, true);
            try {
                init.criticalChanges_?.next?.(true);
            } catch {
            }

            const reboundLogical = model.getVisual?.()?.logicalElement || null;
            const after = {
                attrLabel: getLabelFromModel(model),
                logicalText: reboundLogical?.text ?? null,
                logicalTextForListLogical: reboundLogical?.textForListLogical ?? null,
                logicalLid: reboundLogical?.lid ?? null
            };

            const report = {
                targetId: getIdFromModel(model),
                targetType: getNodeType(model),
                action: "useExisting",
                requestedLabel: value,
                existingLogicalLid: existence?.exist?.lid ?? null,
                before,
                after
            };

            log("renameNodeAio", report);
            return report;
        }

        try {
            logical.opmModel.logForUndo?.((logical.text || before.attrLabel || "thing") + " name change");
            logical.opmModel.setShouldLogForUndoRedo?.(false, "name change");
        } catch {
        }

        try {
            logical.textModule.name.autoFormatting = false;
        } catch {
        }
        try {
            logical.text = value;
        } catch {
        }
        try {
            logical.textForListLogical = value;
        } catch {
        }
        try {
            model.attr({text: {textWrap: {text: value}}});
        } catch {
        }
        try {
            model.updateSiblings(visual, init);
        } catch {
        }
        try {
            model.updateView(visual);
        } catch {
        }
        try {
            init.graphService?.renderGraph?.(init.opmModel.currentOpd, init, null, false, true);
        } catch {
        }
        try {
            init.criticalChanges_?.next?.(true);
        } catch {
        }

        const after = {
            attrLabel: getLabelFromModel(model),
            logicalText: logical?.text ?? null,
            logicalTextForListLogical: logical?.textForListLogical ?? null,
            logicalLid: logical?.lid ?? null
        };

        const report = {
            targetId: getIdFromModel(model),
            targetType: getNodeType(model),
            action: "rename",
            requestedLabel: value,
            before,
            after
        };

        log("renameNodeAio", report);
        return report;
    }

    async function deleteNodeAio(target, {
        selectDelayMs = 250,
        deleteDelayMs = 250,
        allowRawFallback = false,
        removeType = 1,
        preferDirectRemove = true
    } = {}) {
        await ensureUiSeedCaptured();

        const model = typeof target === "string" ? findAnyModelByLabel(target) : target;
        if (!model) throw new Error("Target node not found");

        const init = BOOT.capturedUiSeed.init;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const before = {
            id: getIdFromModel(model),
            label: getLabelFromModel(model),
            type: getNodeType(model)
        };

        let invocation = null;

        if (preferDirectRemove && typeof init.onRemoveOptionChosen === "function") {
            if (typeof init.setElementToRemoveToNull === "function") {
                try {
                    init.setElementToRemoveToNull();
                } catch {
                }
            }
            init.elementToRemove = model;
            init.onRemoveOptionChosen(model, removeType);
            if (typeof init.setElementToRemoveToNull === "function") {
                try {
                    init.setElementToRemoveToNull();
                } catch {
                }
            }
            invocation = `onRemoveOptionChosen(${removeType})`;
            if (deleteDelayMs > 0) {
                await sleep(deleteDelayMs);
            }
        } else {
            const dom = getDomForModel(model);
            if (!dom) throw new Error("Could not find DOM element for delete target");

            log("deleteNodeAio.select", {
                ...before,
                removeType,
                click: dispatchMouseSequence(dom)
            });

            if (selectDelayMs > 0) {
                await sleep(selectDelayMs);
            }

            if (typeof init.setElementToRemoveToNull === "function") {
                try {
                    init.setElementToRemoveToNull();
                } catch {
                }
            }

            if (typeof init.onRemoveOptionChosen === "function") {
                init.elementToRemove = model;
                init.onRemoveOptionChosen(model, removeType);
                if (typeof init.setElementToRemoveToNull === "function") {
                    try {
                        init.setElementToRemoveToNull();
                    } catch {
                    }
                }
                invocation = `onRemoveOptionChosen(${removeType})`;
                if (deleteDelayMs > 0) {
                    await sleep(deleteDelayMs);
                }
            } else {
                const removeAction = init?.elementToolbarReference?.removeHandle?.action;
                if (removeAction && typeof removeAction.act === "function") {
                    removeAction.act();
                    invocation = "removeAction.act()";
                    if (deleteDelayMs > 0) {
                        await sleep(deleteDelayMs);
                    }
                } else if (allowRawFallback && typeof model.remove === "function") {
                    model.remove();
                    invocation = "model.remove()";
                    if (deleteDelayMs > 0) {
                        await sleep(deleteDelayMs);
                    }
                } else {
                    throw new Error("No callable semantic delete path available");
                }
            }
        }

        const stillOnCanvas = !!getDomForModel(model);
        const report = {
            targetId: before.id,
            targetLabel: before.label,
            targetType: before.type,
            removeType,
            invocation,
            stillOnCanvas
        };

        log("deleteNodeAio", report);
        return report;
    }

    async function setEssenceAio(target, spec) {
        await ensureUiSeedCaptured();

        const model = typeof target === "string" ? findObjectByLabel(target) : target;
        if (!model) throw new Error("Target object not found");

        const visual = model.getVisual?.();
        const logical = visual?.logicalElement;
        const init = BOOT.capturedUiSeed.init;

        if (!visual) throw new Error("Target node has no visual object");
        if (!logical) throw new Error("Target node has no logical element");
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const parsed = parseEssenceSpec(spec);
        const before = {
            essence: logical._essence,
            affiliation: logical._affiliation
        };

        logical._essence = parsed.essence;
        logical._affiliation = parsed.affiliation;

        model.updateSiblings(visual, init);

        const report = {
            targetId: getIdFromModel(model),
            targetLabel: getLabelFromModel(model),
            targetType: getNodeType(model),
            before,
            after: {
                essence: logical._essence,
                affiliation: logical._affiliation
            },
            spec: parsed
        };

        log("setEssenceAio", report);
        return report;
    }

    function findAnyModelByLabel(label) {
        return getMainElementModels().find(m => getLabelFromModel(m) === label) || null;
    }

    function findModelByLogicalLid(logicalLid) {
        if (!logicalLid) return null;
        return getMainElementModels().find(m => {
            try {
                return m?.getVisual?.()?.logicalElement?.lid === logicalLid;
            } catch {
                return false;
            }
        }) || null;
    }

    function refreshModelRef(target) {
        const model = typeof target === "string" ? findAnyModelByLabel(target) : target;
        if (!model) return null;

        const logicalLid = model?.getVisual?.()?.logicalElement?.lid ?? null;
        const modelId = getIdFromModel(model);

        return (
            findModelByLogicalLid(logicalLid) ||
            getMainElementModels().find(m => getIdFromModel(m) === modelId) ||
            model
        );
    }

    function normalizeLinkParams(params) {
        if (!params || typeof params !== "object") {
            throw new Error("Link params object is required");
        }
        if (typeof params.type !== "number") {
            throw new Error("Link params must include numeric type");
        }

        return {
            type: params.type,
            connection: typeof params.connection === "number" ? params.connection : 0,
            isCondition: params.isCondition === true,
            isEvent: params.isEvent === true,
            isNegation: params.isNegation === true,
            ...(params.path !== undefined ? {path: params.path} : {}),
            ...(params.linkRequirements !== undefined ? {linkRequirements: params.linkRequirements} : {})
        };
    }

    function resolveLinkEndpoint(target) {
        if (!target) throw new Error("Link endpoint is required");

        if (typeof target === "string") {
            const model = findAnyModelByLabel(target);
            if (!model) throw new Error(`Could not find endpoint by label: ${target}`);
            if (typeof model.getVisual !== "function") {
                throw new Error(`Endpoint by label has no visual object: ${target}`);
            }
            return model.getVisual();
        }

        if (typeof target.getVisual === "function") {
            return target.getVisual();
        }

        if (target.logicalElement || target.constructor?.name?.startsWith("OpmVisual")) {
            return target;
        }

        throw new Error("Unsupported link endpoint; provide label, model, or visual object");
    }

    function summarizeSemanticLink(link) {
        if (!link) return null;
        return {
            id: link.id ?? null,
            ctor: link.constructor?.name ?? null,
            logicalCtor: link.logicalElement?.constructor?.name ?? null,
            linkType: link.logicalElement?.linkType ?? null,
            isFundamental: typeof link.isFundamentalLink === "function" ? link.isFundamentalLink() : null,
            isProcedural: typeof link.isProceduralLink === "function" ? link.isProceduralLink() : null,
            sourceId: link.sourceVisualElement?.id ?? null,
            targetIds: Array.isArray(link.targetVisualElements)
                ? link.targetVisualElements.map(t => t?.targetVisualElement?.id ?? null)
                : null
        };
    }

    async function addLinkAio(source, target, params, {redraw = true} = {}) {
        await ensureUiSeedCaptured();

        const init = BOOT.capturedUiSeed.init;
        const model = init?.opmModel;
        const links = model?.links;
        const graphService = init?.graphService;

        if (!model || !links || typeof links.connect !== "function") {
            throw new Error("No valid LinksModel.connect available");
        }
        if (!graphService || typeof graphService.updateLinksView !== "function") {
            throw new Error("No valid GraphService.updateLinksView available");
        }

        const sourceVisual = resolveLinkEndpoint(source);
        const targetVisual = resolveLinkEndpoint(target);
        const linkParams = normalizeLinkParams(params);

        const created = links.connect(sourceVisual, targetVisual, linkParams);
        if (!created) {
            throw new Error("LinksModel.connect did not return a created link");
        }

        if (redraw) {
            graphService.updateLinksView([created]);
        }

        const report = {
            source: {
                id: sourceVisual.id ?? null,
                ctor: sourceVisual.constructor?.name ?? null,
                logicalCtor: sourceVisual.logicalElement?.constructor?.name ?? null
            },
            target: {
                id: targetVisual.id ?? null,
                ctor: targetVisual.constructor?.name ?? null,
                logicalCtor: targetVisual.logicalElement?.constructor?.name ?? null
            },
            params: linkParams,
            created: summarizeSemanticLink(created),
            redrawn: !!redraw
        };

        log("addLinkAio", report);
        return {created, report};
    }

    async function inzoomTargetAio(target, {delayMs = 80} = {}) {
        await ensureUiSeedCaptured();

        const init = BOOT?.capturedUiSeed?.init;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const model0 = typeof target === "string" ? findAnyModelByLabel(target) : (refreshModelRef(target) || target);
        if (!model0) throw new Error(`Could not resolve target: ${target}`);

        const type0 = getNodeType(model0);
        if (type0 !== "opm.Object" && type0 !== "opm.Process") {
            throw new Error(`Target must be opm.Object or opm.Process, got ${type0}`);
        }

        const targetId = getIdFromModel(model0);
        if (!targetId) throw new Error("Resolved target has no ID");

        const cell = init?.graph?.getCell?.(targetId);
        if (!cell) throw new Error(`init.graph.getCell(${targetId}) returned null`);
        if (typeof cell.inzoomAction !== "function") {
            throw new Error("Target cell does not expose inzoomAction(init)");
        }

        const before = {
            id: getIdFromModel(model0),
            type: getNodeType(model0),
            label: getLabelFromModel(model0),
            logicalLid: model0?.getVisual?.()?.logicalElement?.lid ?? null,
            embeds: model0?.toJSON?.()?.embeds || []
        };

        cell.inzoomAction(init);
        if (delayMs > 0) {
            await sleep(delayMs);
        }

        const model1 =
            findModelByLogicalLid(before.logicalLid) ||
            findAnyModelByLabel(before.label) ||
            refreshModelRef(model0) ||
            model0;

        const report = {
            before,
            after: {
                id: getIdFromModel(model1),
                type: getNodeType(model1),
                label: getLabelFromModel(model1),
                logicalLid: model1?.getVisual?.()?.logicalElement?.lid ?? null,
                embeds: model1?.toJSON?.()?.embeds || []
            }
        };
        log("inzoomTargetAio", report);
        return model1;
    }

    function getCurrentOpd() {
        return BOOT.capturedUiSeed.init?.opmModel?.currentOpd || null;
    }

    function summarizeOpd(opd) {
        if (!opd) return null;
        return {
            id: opd.id ?? null,
            name: opd.name ?? null,
            ctor: opd.constructor?.name ?? null,
            parendId: opd.parendId ?? null,
            childCount: Array.isArray(opd.children) ? opd.children.length : null,
            visualCount: Array.isArray(opd.visualElements) ? opd.visualElements.length : null
        };
    }

    function getOpdById(opdId) {
        const opds = BOOT.capturedUiSeed.init?.opmModel?.opds || [];
        return opds.find(o => o?.id === opdId) || null;
    }

    function getOpdPathById(opdId) {
        const opds = BOOT.capturedUiSeed.init?.opmModel?.opds || [];
        const byId = new Map(opds.map(o => [o?.id, o]));
        const parts = [];
        const seen = new Set();
        let cur = byId.get(opdId) || null;
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            parts.push(cur.name ?? cur.id ?? null);
            if (!cur.parendId || cur.parendId === cur.id) break;
            cur = byId.get(cur.parendId) || null;
        }
        return parts.reverse().filter(Boolean);
    }

    function getCurrentOpdPath() {
        const opd = getCurrentOpd();
        return opd?.id ? getOpdPathById(opd.id) : [];
    }

    function findOpdByNamePath(path) {
        const wanted = JSON.stringify(path || []);
        const opds = BOOT.capturedUiSeed.init?.opmModel?.opds || [];
        return opds.find(o => JSON.stringify(getOpdPathById(o?.id)) === wanted) || null;
    }

    function findCurrentNodeByTypeAndLabel(type, label) {
        return getMainElementModels().find(m => getNodeType(m) === type && getLabelFromModel(m) === label) || null;
    }

    function findCurrentStateByParentLabelAndLabel(parentLabel, stateLabel) {
        const parent = findCurrentNodeByTypeAndLabel("opm.Object", parentLabel);
        if (!parent) return null;
        return getStatesByVisualOrder(parent).find(s => getLabelFromModel(s) === stateLabel) || null;
    }

    function getRuntimeNodeNameKey(model) {
        const type = getNodeType(model);
        const label = getLabelFromModel(model);
        if (!label) return null;
        if (type === "opm.Object") return `object:${label}`;
        if (type === "opm.Process") return `process:${label}`;
        if (type === "opm.State") {
            const j = model?.toJSON?.() || {};
            const parentId = j?.parent ?? null;
            const parent = parentId ? getCurrentGraphCells().find(c => getIdFromModel(c) === parentId) : null;
            const parentLabelResolved = parent ? getLabelFromModel(parent) : null;
            return parentLabelResolved ? `object:${parentLabelResolved}/state:${label}` : `state:${label}`;
        }
        return `${type || "unknown"}:${label}`;
    }

    function resolveNameFriendlyEndpoint(ref) {
        if (!ref) return null;
        if (typeof ref === "string") {
            if (ref.startsWith("object:")) {
                return findCurrentNodeByTypeAndLabel("opm.Object", ref.slice("object:".length));
            }
            if (ref.startsWith("process:")) {
                return findCurrentNodeByTypeAndLabel("opm.Process", ref.slice("process:".length));
            }
            if (ref.startsWith("object:") && ref.includes("/state:")) {
                const m = ref.match(/^object:(.*)\/state:(.*)$/);
                if (m) return findCurrentStateByParentLabelAndLabel(m[1], m[2]);
            }
            const stateMatch = ref.match(/^object:(.*)\/state:(.*)$/);
            if (stateMatch) {
                return findCurrentStateByParentLabelAndLabel(stateMatch[1], stateMatch[2]);
            }
            return findAnyModelByLabel(ref);
        }
        return null;
    }

    function summarizeGraphCell(cell) {
        const j = cell?.toJSON ? cell.toJSON() : {};
        return {
            id: getIdFromModel(cell),
            type: j?.type ?? getNodeType(cell),
            ctor: cell?.constructor?.name ?? null,
            label: j?.attrs?.text?.textWrap?.text ?? null,
            sourceId: j?.source?.id ?? null,
            targetId: j?.target?.id ?? null,
            parent: j?.parent ?? null
        };
    }

    function getCurrentGraphCells() {
        const graph = BOOT.capturedUiSeed.init?.graph || BOOT.cachedGraph || null;
        if (!graph || typeof graph.getCells !== "function") return [];
        return graph.getCells();
    }

    function snapshotRuntimeState() {
        const init = BOOT.capturedUiSeed.init;
        const opmModel = init?.opmModel;
        const currentOpd = opmModel?.currentOpd || null;
        const opds = Array.isArray(opmModel?.opds) ? opmModel.opds : [];
        const graphCells = getCurrentGraphCells();

        return {
            currentOpd: summarizeOpd(currentOpd),
            opdIds: opds.map(o => o?.id).filter(Boolean),
            opds: opds.map(summarizeOpd),
            graphCellIds: graphCells.map(c => getIdFromModel(c)).filter(Boolean),
            graphCells: graphCells.map(summarizeGraphCell)
        };
    }

    function getUnfoldActionForTarget(target) {
        const model = typeof target === "string" ? findAnyModelByLabel(target) : target;
        if (!model) throw new Error("Target node not found");

        const init = BOOT.capturedUiSeed.init;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const dom = getDomForModel(model);
        if (!dom) throw new Error("Could not find DOM element for unfold target");

        return {model, init, dom};
    }

    function diffRuntimeSnapshots(before, after) {
        const beforeOpdIds = new Set(before?.opdIds || []);
        const afterOpdIds = new Set(after?.opdIds || []);
        const beforeCellIds = new Set(before?.graphCellIds || []);
        const afterCellIds = new Set(after?.graphCellIds || []);

        return {
            newOpdIds: [...afterOpdIds].filter(id => !beforeOpdIds.has(id)),
            removedOpdIds: [...beforeOpdIds].filter(id => !afterOpdIds.has(id)),
            newCellIds: [...afterCellIds].filter(id => !beforeCellIds.has(id)),
            removedCellIds: [...beforeCellIds].filter(id => !afterCellIds.has(id))
        };
    }

    async function unfoldTargetAio(target, {
        selectDelayMs = 250,
        unfoldDelayMs = 450,
        clean = false,
        preferDirectClean = true
    } = {}) {
        await ensureUiSeedCaptured();

        const before = snapshotRuntimeState();
        const {model, init, dom} = getUnfoldActionForTarget(target);

        log("unfoldTargetAio.select", {
            id: getIdFromModel(model),
            label: getLabelFromModel(model),
            type: getNodeType(model),
            click: dispatchMouseSequence(dom)
        });

        await sleep(selectDelayMs);

        const action = init?.elementToolbarReference?.unfoldHandle?.action;
        if (!action) throw new Error("No unfold action available");

        const thingId = action?.thing?.id ?? getIdFromModel(model) ?? null;
        const cell = thingId && init?.graph?.getCell ? init.graph.getCell(thingId) : null;

        let invocation = "act";
        if (clean && preferDirectClean && cell && typeof cell.unfoldAction === "function") {
            cell.unfoldAction(init, true);
            invocation = "cell.unfoldAction(init,true)";
        } else if (clean && preferDirectClean && typeof action.unfoldAction === "function") {
            action.unfoldAction(init, true);
            invocation = "action.unfoldAction(init,true)";
        } else if (clean && preferDirectClean && typeof action.unfold === "function") {
            action.unfold(init, thingId, {clean: true});
            invocation = "action.unfold(init,thingId,{clean:true})";
        } else if (typeof action.act === "function") {
            action.act();
            invocation = "act()";
        } else {
            throw new Error("No callable unfold action method found");
        }

        await sleep(unfoldDelayMs);

        const after = snapshotRuntimeState();
        const diff = diffRuntimeSnapshots(before, after);
        const result = {
            targetId: getIdFromModel(model),
            targetLabel: getLabelFromModel(model),
            invocation,
            requestedClean: !!clean,
            beforeCurrentOpd: before.currentOpd,
            afterCurrentOpd: after.currentOpd,
            isNewlyCreated: diff.newOpdIds.length > 0,
            newOpdIds: diff.newOpdIds,
            newCellIds: diff.newCellIds,
            removedCellIds: diff.removedCellIds,
            diff,
            afterGraphCells: after.graphCells,
            afterOpds: after.opds
        };

        log("unfoldTargetAio", result);
        return result;
    }

    function summarizeVisualElement(v) {
        if (!v) return null;
        return {
            id: v.id ?? null,
            ctor: v.constructor?.name ?? null,
            logicalCtor: v.logicalElement?.constructor?.name ?? null,
            logicalLid: v.logicalElement?.lid ?? null,
            logicalText: v.logicalElement?.text ?? null,
            name: v.name ?? null,
            sourceId: v.sourceVisualElement?.id ?? null,
            targetIds: Array.isArray(v.targetVisualElements)
                ? v.targetVisualElements.map(t => t?.targetVisualElement?.id ?? null)
                : null
        };
    }

    function listCurrentOpdContents() {
        const opd = getCurrentOpd();
        const visuals = Array.isArray(opd?.visualElements) ? opd.visualElements : [];
        const graphCells = getCurrentGraphCells();
        const report = {
            currentOpd: summarizeOpd(opd),
            visuals: visuals.map(summarizeVisualElement),
            graphCells: graphCells.map(summarizeGraphCell)
        };
        log("listCurrentOpdContents", report);
        return report;
    }

    function classifyUnfoldScaffold(report) {
        const visuals = Array.isArray(report?.visuals) ? report.visuals : [];
        const objects = visuals.filter(v => /Object/i.test(v?.ctor || ""));
        const triangles = visuals.filter(v => /Triangle/i.test(v?.ctor || ""));
        const links = visuals.filter(v => /Link/i.test(v?.ctor || ""));
        const currentName = report?.currentOpd?.name ?? null;

        const ownerCandidates = objects.filter(v => v.logicalText === currentName || v.name === currentName);
        const protectedIds = new Set();
        ownerCandidates.forEach(v => protectedIds.add(v.id));
        triangles.forEach(v => protectedIds.add(v.id));
        links.forEach(v => {
            if (v.sourceId && protectedIds.has(v.sourceId)) protectedIds.add(v.id);
            if (Array.isArray(v.targetIds) && v.targetIds.some(id => protectedIds.has(id))) protectedIds.add(v.id);
        });

        const autoObjectCandidates = objects.filter(v => !protectedIds.has(v.id));
        const out = {
            currentOpd: report?.currentOpd ?? null,
            ownerCandidates,
            protectedIds: [...protectedIds],
            autoObjectCandidates,
            triangleCount: triangles.length,
            linkCount: links.length,
            objectCount: objects.length
        };
        log("classifyUnfoldScaffold", out);
        return out;
    }

    function getTreeRuntime() {
        const init = BOOT.capturedUiSeed.init;
        const treeViewService = init?.treeViewService || null;
        const treeView = treeViewService?.treeView || null;
        const treeModel = treeView?.treeModel || null;
        return {treeViewService, treeView, treeModel};
    }

    function inspectCurrentFundamentalGroups() {
        const cells = getCurrentGraphCells();
        const byId = new Map(cells.map(c => [getIdFromModel(c), c]));
        const currentOpd = getCurrentOpd();
        const currentOpdPath = getCurrentOpdPath();

        const triangles = cells.filter(c => {
            const t = getNodeType(c);
            const ctor = c?.constructor?.name || "";
            return t === "opm.TriangleAgg" || /Triangle/i.test(ctor);
        });

        const links = cells.filter(c => {
            const t = getNodeType(c);
            const ctor = c?.constructor?.name || "";
            return t === "opm.Link" || /Link/i.test(ctor);
        });

        const out = triangles.map(tri => {
            const triId = getIdFromModel(tri);

            const ownerLink = links.find(l => {
                const j = l.toJSON?.() || {};
                return (l.constructor?.name === "OpmDefaultLink") && j?.target?.id === triId;
            }) || null;

            const memberLinks = links.filter(l => {
                const j = l.toJSON?.() || {};
                const ctor = l.constructor?.name || "";
                return /AggregationLink|ExhibitionLink/i.test(ctor) && j?.source?.id === triId;
            });

            const ownerSourceId = ownerLink?.toJSON?.()?.source?.id ?? null;
            const ownerSource = ownerSourceId ? byId.get(ownerSourceId) : null;
            const ownerLabel = ownerSource ? getLabelFromModel(ownerSource) : null;
            const ownerType = ownerSource ? getNodeType(ownerSource) : null;
            const ownerNameKey = ownerSource ? getRuntimeNodeNameKey(ownerSource) : null;

            return {
                currentOpdId: currentOpd?.id ?? null,
                currentOpdName: currentOpd?.name ?? null,
                currentOpdPath,
                triangleId: triId,
                triangle: tri,
                trianglePosition: getPositionFromModel(tri),
                ownerLinkId: ownerLink ? getIdFromModel(ownerLink) : null,
                ownerLink,
                ownerLabel,
                ownerType,
                ownerNameKey,
                memberLinkIds: memberLinks.map(l => getIdFromModel(l)),
                memberLinks,
                memberTargetIds: memberLinks.map(l => (l.toJSON?.()?.target?.id ?? null)),
                memberTargetLabels: memberLinks.map(l => {
                    const tid = l.toJSON?.()?.target?.id ?? null;
                    const target = tid ? byId.get(tid) : null;
                    return target ? getLabelFromModel(target) : null;
                }),
                memberTargetTypes: memberLinks.map(l => {
                    const tid = l.toJSON?.()?.target?.id ?? null;
                    const target = tid ? byId.get(tid) : null;
                    return target ? getNodeType(target) : null;
                }),
                memberTargetNameKeys: memberLinks.map(l => {
                    const tid = l.toJSON?.()?.target?.id ?? null;
                    const target = tid ? byId.get(tid) : null;
                    return target ? getRuntimeNodeNameKey(target) : null;
                })
            };
        });

        log("inspectCurrentFundamentalGroups", out.map(g => ({
            currentOpdName: g.currentOpdName,
            triangleId: g.triangleId,
            ownerLinkId: g.ownerLinkId,
            ownerLabel: g.ownerLabel,
            memberLinkIds: g.memberLinkIds,
            memberTargetLabels: g.memberTargetLabels
        })));
        return out;
    }

    async function cleanupAllExistingLinksAio({
                                                  removeType = 1,
                                                  deleteDelayMs = 0,
                                                  preferDirectRemove = true
                                              } = {}) {
        await ensureUiSeedCaptured();

        const removed = [];
        const skipped = [];
        const ownerLinkIdsRemoved = new Set();

        const groups = inspectCurrentFundamentalGroups();
        for (const g of groups) {
            if (!g?.ownerLink) continue;
            const rep = await deleteNodeAio(g.ownerLink, {
                removeType,
                deleteDelayMs,
                preferDirectRemove
            });
            ownerLinkIdsRemoved.add(g.ownerLinkId);
            removed.push({
                kind: "fundamental-group-owner-link",
                id: g.ownerLinkId,
                triangleId: g.triangleId,
                rep
            });
        }

        const remainingLinks = getCurrentGraphCells().filter(c => {
            const t = getNodeType(c);
            const ctor = c?.constructor?.name || "";
            return t === "opm.Link" || /Link/i.test(ctor);
        });

        for (const link of remainingLinks) {
            const id = getIdFromModel(link);
            if (ownerLinkIdsRemoved.has(id)) continue;
            try {
                const rep = await deleteNodeAio(link, {
                    removeType,
                    deleteDelayMs,
                    preferDirectRemove
                });
                removed.push({
                    kind: "remaining-link",
                    id,
                    ctor: link?.constructor?.name || null,
                    rep
                });
            } catch (e) {
                skipped.push({
                    id,
                    ctor: link?.constructor?.name || null,
                    error: String(e)
                });
            }
        }

        const report = {
            removed,
            skipped,
            remainingGraphLinks: getCurrentGraphCells().filter(c => {
                const t = getNodeType(c);
                const ctor = c?.constructor?.name || "";
                return t === "opm.Link" || /Link/i.test(ctor);
            }).map(summarizeGraphCell)
        };

        log("cleanupAllExistingLinksAio", report);
        return report;
    }

    function navigateToOpdAio(opdId, {expandParents = true, activate = true, render = true} = {}) {
        const init = BOOT.capturedUiSeed.init;
        const opmModel = init?.opmModel;
        const opd = Array.isArray(opmModel?.opds) ? opmModel.opds.find(o => o?.id === opdId) : null;
        if (!opd) throw new Error(`OPD not found: ${opdId}`);

        const {treeViewService, treeModel} = getTreeRuntime();
        const node = treeModel?.getNodeById ? treeModel.getNodeById(opdId) : null;

        if (expandParents && node?.parent?.expand) {
            try {
                node.parent.expand();
            } catch {
            }
        }
        if (activate && node?.toggleActivated) {
            try {
                node.toggleActivated();
            } catch {
            }
        }
        if (render && init?.graphService?.renderGraph) {
            init.graphService.renderGraph(opd, init);
        }
        try {
            opmModel.currentOpd = opd;
        } catch {
        }
        try {
            if (treeViewService?.currentOPD) treeViewService.currentOPD = opdId;
        } catch {
        }

        const report = {
            target: summarizeOpd(opd),
            targetPath: getOpdPathById(opd.id),
            treeNodeFound: !!node,
            afterCurrentOpd: summarizeOpd(getCurrentOpd())
        };
        log("navigateToOpdAio", report);
        return report;
    }

    function navigateToOpdByNamePathAio(path, {expandParents = true, activate = true, render = false} = {}) {
        const opd = findOpdByNamePath(path);
        if (!opd?.id) throw new Error(`OPD path not found: ${JSON.stringify(path)}`);
        return navigateToOpdAio(opd.id, {expandParents, activate, render});
    }

    function setCurrentOpdWithoutRenderAio(opdId, {expandParents = true, activate = true} = {}) {
        return navigateToOpdAio(opdId, {expandParents, activate, render: false});
    }

    /* -----------------------------
       Export / Import helpers
    ------------------------------*/

    function exportCurrentOpdV2() {
        function safe(fn, fallback = null) {
            try {
                return fn();
            } catch {
                return fallback;
            }
        }

        function getGraph() {
            return (
                BOOT.cachedGraph ||
                BOOT.capturedUiSeed?.init?.graph ||
                safe(() => getMainElementModels()[0]?.graph) ||
                safe(() => getMainElementModels()[0]?.collection?.graph) ||
                safe(() => getMainElementModels()[0]?.collection) ||
                null
            );
        }

        function getAllCells() {
            const graph = getGraph();
            if (!graph || typeof graph.getCells !== "function") {
                throw new Error("Could not recover graph");
            }
            return graph.getCells();
        }

        function getJson(m) {
            return safe(() => m.toJSON(), {}) || {};
        }

        function getCtor(m) {
            return m?.constructor?.name ?? null;
        }

        function getVisual(m) {
            return safe(() => m.getVisual()) || null;
        }

        function getLogical(m) {
            return getVisual(m)?.logicalElement || m?.logicalElement || null;
        }

        function summarizeNodeExport(m) {
            const j = getJson(m);
            const l = getLogical(m);
            const embeds = Array.isArray(j.embeds) ? j.embeds.slice() : [];
            const embeddedThingIds = embeds.filter(id => {
                const cell = getAllCells().find(c => getIdFromModel(c) === id) || null;
                const t = getNodeType(cell);
                return t === "opm.Object" || t === "opm.Process";
            });
            return {
                id: getIdFromModel(m),
                type: getNodeType(m),
                label: getLabelFromModel(m),
                position: j.position || null,
                size: j.size || null,
                essence: l?._essence ?? null,
                affiliation: l?._affiliation ?? null,
                logicalLid: l?.lid ?? null,
                parentId: j.parent ?? null,
                embeddedIds: embeds,
                embeddedThingIds,
                isInZoomContainer: embeddedThingIds.length > 0
            };
        }

        function summarizeStateExport(m) {
            const j = getJson(m);
            const l = getLogical(m);
            return {
                id: getIdFromModel(m),
                label: getLabelFromModel(m),
                position: j.position || null,
                size: j.size || null,
                parentId: j.parent ?? null,
                logicalLid: l?.lid ?? null
            };
        }

        function summarizeTriangleExport(m) {
            const j = getJson(m);
            return {
                id: getIdFromModel(m),
                type: getNodeType(m),
                ctor: getCtor(m),
                position: j.position || null,
                size: j.size || null,
                angle: j.angle ?? null
            };
        }

        function classifyLinkExport(m) {
            const ctor = getCtor(m) || "";
            const logicalCtor = getLogical(m)?.constructor?.name || "";

            if (/Triangle/i.test(ctor) || getNodeType(m) === "opm.TriangleAgg") return "triangle";
            if (/Consumption|Result|Instrument|Effect/i.test(ctor)) return "procedural";
            if (/Aggregation|Exhibition/i.test(ctor)) return "fundamental-member";
            if (/OpmDefaultLink/i.test(ctor)) return "default";
            if (/Fundamental/i.test(logicalCtor)) return "fundamental-member";
            if (/Procedural/i.test(logicalCtor)) return "procedural";
            return "unknown";
        }

        function endpointIdFromRef(ref) {
            if (!ref) return null;
            if (typeof ref.id === "string") return ref.id;
            if (typeof ref === "string") return ref;
            return null;
        }

        function extractGeometry(j) {
            return {
                vertices: Array.isArray(j.vertices) ? j.vertices : [],
                labels: Array.isArray(j.labels) ? j.labels : [],
                rawSource: j.source || null,
                rawTarget: j.target || null
            };
        }

        function summarizeLinkExport(m) {
            const j = getJson(m);
            const l = getLogical(m);

            return {
                id: getIdFromModel(m),
                type: getNodeType(m),
                ctor: getCtor(m),
                logicalCtor: l?.constructor?.name ?? null,
                logicalLid: l?.lid ?? null,
                linkType: l?.linkType ?? null,
                relationType: l?.relationType ?? null,
                family: classifyLinkExport(m),
                sourceId: endpointIdFromRef(j.source),
                targetId: endpointIdFromRef(j.target),
                geometry: extractGeometry(j)
            };
        }

        const all = getAllCells();

        const objects = all.filter(m => getNodeType(m) === "opm.Object");
        const processes = all.filter(m => getNodeType(m) === "opm.Process");
        const states = all.filter(m => getNodeType(m) === "opm.State");
        const triangles = all.filter(m => classifyLinkExport(m) === "triangle");
        const links = all.filter(m => {
            const t = getNodeType(m);
            const c = getCtor(m) || "";
            return t === "opm.Link" || /Link/i.test(c);
        });

        const nodeSummaries = [...objects, ...processes].map(summarizeNodeExport);
        const stateSummaries = states.map(summarizeStateExport);
        const triangleSummaries = triangles.map(summarizeTriangleExport);
        const linkSummaries = links.map(summarizeLinkExport);

        const nodeById = Object.fromEntries(nodeSummaries.map(n => [n.id, n]));
        const stateById = Object.fromEntries(stateSummaries.map(s => [s.id, s]));
        const triangleById = Object.fromEntries(triangleSummaries.map(t => [t.id, t]));
        const triangleIds = new Set(triangles.map(getIdFromModel));

        const statesByParent = {};
        for (const s of stateSummaries) {
            const p = s.parentId || "__NO_PARENT__";
            if (!statesByParent[p]) statesByParent[p] = [];
            statesByParent[p].push(s);
        }

        for (const k of Object.keys(statesByParent)) {
            statesByParent[k].sort((a, b) => {
                const ay = a.position?.y ?? 0;
                const by = b.position?.y ?? 0;
                if (ay !== by) return ay - by;
                const ax = a.position?.x ?? 0;
                const bx = b.position?.x ?? 0;
                return ax - bx;
            });
        }

        const directProceduralLinks = [];
        const defaultLinksToTriangles = [];
        const fundamentalMemberLinks = [];
        const leftovers = [];

        for (const l of linkSummaries) {
            if (l.family === "procedural") {
                directProceduralLinks.push(l);
                continue;
            }
            if (l.family === "default" && triangleIds.has(l.targetId)) {
                defaultLinksToTriangles.push(l);
                continue;
            }
            if (l.family === "fundamental-member" && triangleIds.has(l.sourceId)) {
                fundamentalMemberLinks.push(l);
                continue;
            }
            leftovers.push(l);
        }

        const ownerByTriangle = {};
        const ownerLinkByTriangle = {};
        for (const l of defaultLinksToTriangles) {
            ownerByTriangle[l.targetId] = l.sourceId;
            ownerLinkByTriangle[l.targetId] = l;
        }

        const membersByTriangle = {};
        for (const l of fundamentalMemberLinks) {
            if (!membersByTriangle[l.sourceId]) membersByTriangle[l.sourceId] = [];
            membersByTriangle[l.sourceId].push(l);
        }

        function resolveEntityType(id) {
            if (!id) return null;
            if (nodeById[id]) return nodeById[id].type;
            if (stateById[id]) return "opm.State";
            return null;
        }

        function resolveEntityLabel(id) {
            if (!id) return null;
            if (nodeById[id]) return nodeById[id].label;
            if (stateById[id]) return stateById[id].label;
            return null;
        }

        function resolveEntityLogicalLid(id) {
            if (!id) return null;
            if (nodeById[id]) return nodeById[id].logicalLid ?? null;
            if (stateById[id]) return stateById[id].logicalLid ?? null;
            return null;
        }

        const triangleGroups = [...triangleIds].map(triangleId => {
            const ownerId = ownerByTriangle[triangleId] || null;
            const memberLinks = membersByTriangle[triangleId] || [];
            const ownerLink = ownerLinkByTriangle[triangleId] || null;
            const triangle = triangleById[triangleId] || null;

            return {
                triangleId,
                triangleGeometry: triangle ? {
                    position: triangle.position || null,
                    size: triangle.size || null,
                    angle: triangle.angle ?? null
                } : null,
                ownerId,
                ownerLabel: resolveEntityLabel(ownerId),
                ownerType: resolveEntityType(ownerId),
                ownerLogicalLid: resolveEntityLogicalLid(ownerId),
                groupType: memberLinks[0]?.linkType ?? null,
                memberIds: memberLinks.map(x => x.targetId).filter(Boolean),
                memberLabels: memberLinks.map(x => resolveEntityLabel(x.targetId)),
                memberTypes: memberLinks.map(x => resolveEntityType(x.targetId)),
                memberLogicalLids: memberLinks.map(x => resolveEntityLogicalLid(x.targetId)),
                ownerLink: ownerLink ? {
                    id: ownerLink.id,
                    ctor: ownerLink.ctor,
                    geometry: ownerLink.geometry
                } : null,
                memberLinks: memberLinks.map(x => ({
                    id: x.id,
                    ctor: x.ctor,
                    logicalCtor: x.logicalCtor,
                    logicalLid: x.logicalLid ?? null,
                    linkType: x.linkType,
                    targetId: x.targetId,
                    targetLabel: resolveEntityLabel(x.targetId),
                    targetType: resolveEntityType(x.targetId),
                    targetLogicalLid: resolveEntityLogicalLid(x.targetId),
                    geometry: x.geometry
                }))
            };
        });

        const exportData = {
            version: 2,
            meta: {
                exportedAt: new Date().toISOString(),
                tool: "opcloud-single-boot-toolkit"
            },
            nodes: nodeSummaries,
            statesByParent,
            proceduralLinks: directProceduralLinks.map(l => ({
                id: l.id,
                ctor: l.ctor,
                logicalCtor: l.logicalCtor,
                logicalLid: l.logicalLid ?? null,
                linkType: l.linkType,
                sourceId: l.sourceId,
                targetId: l.targetId,
                geometry: l.geometry
            })),
            fundamentalGroups: triangleGroups,
            leftovers
        };

        log("exportCurrentOpdV2", {
            nodeCount: exportData.nodes.length,
            stateParentCount: Object.keys(exportData.statesByParent || {}).length,
            proceduralLinks: exportData.proceduralLinks.length,
            fundamentalGroups: exportData.fundamentalGroups.length,
            leftovers: exportData.leftovers.length
        });

        return exportData;
    }

    function exportEntireOpdTree() {
        const init = BOOT.capturedUiSeed.init;
        if (!looksLikeInitRappidService(init)) {
            throw new Error("No valid captured InitRappidService available");
        }

        const opmModel = init?.opmModel;
        const opds = Array.isArray(opmModel?.opds) ? opmModel.opds.slice() : [];
        if (!opds.length) {
            throw new Error("No OPDs available to export");
        }

        const previousCurrentOpd = getCurrentOpd();
        const byId = new Map(opds.map(opd => [opd.id, opd]));

        function getOpdPath(opdId) {
            const parts = [];
            const seen = new Set();
            let cur = byId.get(opdId) || null;
            while (cur && !seen.has(cur.id)) {
                seen.add(cur.id);
                parts.push(cur.name ?? cur.id ?? null);
                if (!cur.parendId || cur.parendId === cur.id) break;
                cur = byId.get(cur.parendId) || null;
            }
            return parts.reverse().filter(Boolean);
        }

        function inferFocalThingLabel(opd) {
            if (!opd) return null;
            if (opd.id === "SD") return null;
            return opd.name ?? null;
        }

        function inferParentOpdName(opd) {
            const parent = opd?.parendId ? byId.get(opd.parendId) : null;
            return parent?.name ?? null;
        }

        const entries = [];
        for (const opd of opds) {
            navigateToOpdAio(opd.id, {expandParents: true, activate: true, render: true});
            const local = exportCurrentOpdV2();
            const contents = listCurrentOpdContents();
            const scaffold = classifyUnfoldScaffold(contents);

            entries.push({
                hierarchy: {
                    opdId: opd.id,
                    opdName: opd.name ?? null,
                    opdPath: getOpdPath(opd.id),
                    parentOpdId: opd.parendId ?? null,
                    parentOpdName: inferParentOpdName(opd),
                    childOpdIds: Array.isArray(opd.children) ? opd.children.map(c => c?.id).filter(Boolean) : [],
                    focalThingLabelInParent: inferFocalThingLabel(opd)
                },
                local,
                currentContents: contents,
                scaffold
            });
        }

        if (previousCurrentOpd?.id) {
            try {
                navigateToOpdAio(previousCurrentOpd.id, {expandParents: true, activate: true, render: true});
            } catch {
            }
        }

        const exportData = {
            version: 1,
            meta: {
                exportedAt: new Date().toISOString(),
                tool: "opcloud-single-boot-toolkit",
                currentOpdAtExport: previousCurrentOpd ? summarizeOpd(previousCurrentOpd) : null,
                opdCount: entries.length
            },
            opds: entries
        };

        log("exportEntireOpdTree", {
            opdCount: entries.length,
            names: entries.map(e => e.hierarchy.opdName)
        });

        return exportData;
    }

    async function importOpdData(data, {cleanupBefore = false} = {}) {
        function assert(cond, msg) {
            if (!cond) throw new Error(msg);
        }

        function isObjectNode(n) {
            return n?.type === "opm.Object";
        }

        function isProcessNode(n) {
            return n?.type === "opm.Process";
        }

        function stateArraysOf(x) {
            return Object.entries(x.statesByParent || {});
        }

        function summarizeModel(m) {
            return {
                id: getIdFromModel(m),
                type: getNodeType(m),
                label: getLabelFromModel(m),
                position: getPositionFromModel(m)
            };
        }

        function isSelfInvocationExportedLink(link) {
            if (!link) return false;
            if (link.linkType === 5) return true;
            const ctor = String(link.ctor || "");
            return /SelfInvocation/i.test(ctor);
        }

        function isSelfInvocationRuntimeLink(link) {
            if (!link) return false;
            const ctor = String(link?.constructor?.name || "");
            const logicalType = link?.logicalElement?.linkType ?? null;
            const j = link?.toJSON?.() || {};
            const sid = j?.source?.id ?? null;
            const tid = j?.target?.id ?? null;
            return logicalType === 5 || /SelfInvocation/i.test(ctor) || (!!sid && sid === tid);
        }

        function getCellById(id) {
            return getCurrentGraphCells().find(c => getIdFromModel(c) === id) || null;
        }

        function refreshLinksByIds(linkIds) {
            const init = BOOT.capturedUiSeed.init;
            const links = linkIds.map(id => getCellById(id)).filter(Boolean);
            try {
                init?.graphService?.updateLinksView?.(links);
            } catch {
            }
            return links;
        }

        function buildNodeRefFromModel(model) {
            const refreshed = refreshModelRef(model) || model;
            return {
                kind: "node",
                nodeType: getNodeType(refreshed),
                label: getLabelFromModel(refreshed)
            };
        }

        function buildStateRef(parentModelOrLabel, stateLabel) {
            const parentLabel = typeof parentModelOrLabel === "string"
                ? parentModelOrLabel
                : getLabelFromModel(refreshModelRef(parentModelOrLabel) || parentModelOrLabel);
            return {
                kind: "state",
                parentLabel,
                label: stateLabel
            };
        }

        function resolveRuntimeRef(ref) {
            if (!ref) return null;
            if (ref.kind === "node") {
                return findCurrentNodeByTypeAndLabel(ref.nodeType, ref.label) || null;
            }
            if (ref.kind === "state") {
                return findCurrentStateByParentLabelAndLabel(ref.parentLabel, ref.label) || null;
            }
            return null;
        }

        function buildLinkParamsFromProceduralLink(link) {
            return {
                type: link.linkType,
                connection: 0,
                isCondition: false,
                isEvent: false,
                isNegation: false
            };
        }

        function buildLinkParamsFromFundamentalMember(memberLink) {
            return {
                type: memberLink.linkType,
                connection: 0,
                isCondition: false,
                isEvent: false,
                isNegation: false
            };
        }

        async function applyNodeGeometry(model, exportedNode) {
            const refreshed = refreshModelRef(model) || model;
            const p = exportedNode?.position;
            if (p && typeof p.x === "number" && typeof p.y === "number") {
                const hasChildren = getEmbeddedThingChildren(refreshed, {deep: true}).length > 0;
                if (hasChildren) {
                    moveAndKeepChildrenPositionByPosition(refreshed, p.x, p.y);
                } else {
                    refreshed.position(p.x, p.y, {});
                }
            }
            return {
                runtimeId: getIdFromModel(refreshed),
                applied: !!p
            };
        }

        async function applyStateGeometry(runtimeStateModel, exportedState) {
            return {
                exportedId: exportedState.id,
                runtimeId: getIdFromModel(runtimeStateModel),
                skipped: true
            };
        }

        async function applyLinkGeometry(runtimeLinkId, exportedGeometry, exportedLink = null) {
            const link = runtimeLinkId ? getCellById(runtimeLinkId) : null;
            const vertices = Array.isArray(exportedGeometry?.vertices) ? exportedGeometry.vertices : [];

            if (!link) {
                return {
                    runtimeId: runtimeLinkId ?? null,
                    applied: false,
                    reason: "runtime link not found",
                    verticesCount: vertices.length
                };
            }

            if (isSelfInvocationExportedLink(exportedLink) || isSelfInvocationRuntimeLink(link)) {
                return {
                    runtimeId: runtimeLinkId,
                    applied: false,
                    skipped: true,
                    reason: "self-invocation geometry replay skipped",
                    verticesCount: vertices.length,
                    ctor: link?.constructor?.name ?? null,
                    linkType: link?.logicalElement?.linkType ?? null
                };
            }

            if (typeof link.vertices === "function") {
                link.vertices(vertices);
            } else {
                link.set("vertices", vertices);
            }
            refreshLinksByIds([runtimeLinkId]);

            return {
                runtimeId: runtimeLinkId,
                applied: true,
                verticesCount: vertices.length,
                hasLabels: !!(exportedGeometry?.labels?.length),
                hasRawSource: !!exportedGeometry?.rawSource,
                hasRawTarget: !!exportedGeometry?.rawTarget
            };
        }

        async function applyTriangleGeometry(runtimeTriangleId, triangleGeometry, affectedLinkIds = []) {
            const triangle = runtimeTriangleId ? getCellById(runtimeTriangleId) : null;
            const p = triangleGeometry?.position;
            if (!triangle) {
                return {
                    runtimeId: runtimeTriangleId ?? null,
                    applied: false,
                    reason: "runtime triangle not found"
                };
            }

            if (p && typeof p.x === "number" && typeof p.y === "number") {
                triangle.position(p.x, p.y);
            }
            refreshLinksByIds(affectedLinkIds);

            return {
                runtimeId: runtimeTriangleId,
                applied: !!p,
                position: p || null,
                affectedLinkIds
            };
        }

        async function ensureRuntimeInZoomForExportedNode(exportedNode, oldIdToRuntimeRef) {
            const shouldInZoom = !!(
                exportedNode && (
                    exportedNode.isInZoomContainer === true ||
                    (Array.isArray(exportedNode.embeddedThingIds) && exportedNode.embeddedThingIds.length > 0)
                )
            );
            if (!shouldInZoom) {
                return resolveRuntimeRef(oldIdToRuntimeRef.get(exportedNode?.id));
            }
            let runtimeModel = resolveRuntimeRef(oldIdToRuntimeRef.get(exportedNode.id));
            if (!runtimeModel) return null;
            runtimeModel = refreshModelRef(runtimeModel) || runtimeModel;
            const runtimeEmbeddedThingCount = getEmbeddedThingChildren(runtimeModel, {deep: false})
                .filter(c => {
                    const t = getNodeType(c);
                    return t === "opm.Object" || t === "opm.Process";
                }).length;
            if (runtimeEmbeddedThingCount === 0) {
                runtimeModel = await inzoomTargetAio(runtimeModel);
                runtimeModel = refreshModelRef(runtimeModel) || runtimeModel;
                oldIdToRuntimeRef.set(exportedNode.id, buildNodeRefFromModel(runtimeModel));
            }
            return runtimeModel;
        }

        async function createRuntimeNodeFromExported(node, parentModel = null) {
            const args = {
                label: node.label,
                x: node.position?.x,
                y: node.position?.y,
                ...(parentModel ? {parent: parentModel} : {})
            };
            let model;
            if (isObjectNode(node)) {
                model = await addObjectAio(args);
            } else if (isProcessNode(node)) {
                model = await addProcessAio(args);
            } else {
                throw new Error(`Unsupported node type: ${node.type}`);
            }
            return refreshModelRef(model) || model;
        }

        assert(data && typeof data === "object", "data object required");
        assert(Array.isArray(data.nodes), "data.nodes must be an array");

        await bootstrapRuntimeOnce();

        if (cleanupBefore) {
            await cleanupSingleBoot();
        }

        const oldIdToRuntimeRef = new Map();
        const oldStateIdToRuntimeRef = new Map();
        const exportedNodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];
        const topLevelNodes = exportedNodes.filter(n => !n?.parentId);
        const embeddedNodes = exportedNodes.filter(n => !!n?.parentId);
        const exportedNodeById = new Map(exportedNodes.map(n => [n.id, n]));

        const reports = {
            createdNodes: [],
            createdStates: [],
            essenceApplied: [],
            proceduralLinks: [],
            fundamentalGroups: [],
            deferredGeometry: {
                node: [],
                state: [],
                link: [],
                triangle: []
            }
        };

        for (const node of topLevelNodes) {
            const model = await createRuntimeNodeFromExported(node, null);
            oldIdToRuntimeRef.set(node.id, buildNodeRefFromModel(model));
            reports.createdNodes.push({
                exported: node,
                runtime: summarizeModel(model)
            });
        }

        for (const node of topLevelNodes) {
            await ensureRuntimeInZoomForExportedNode(node, oldIdToRuntimeRef);
        }

        const pendingEmbedded = embeddedNodes.slice();
        while (pendingEmbedded.length) {
            let progressed = false;
            for (let i = 0; i < pendingEmbedded.length; i++) {
                const node = pendingEmbedded[i];
                const parentExported = exportedNodeById.get(node.parentId) || null;
                if (!parentExported) {
                    throw new Error(`Missing exported parent node for embedded node ${node.label}`);
                }
                let parentModel = resolveRuntimeRef(oldIdToRuntimeRef.get(node.parentId));
                if (!parentModel) continue;
                parentModel = await ensureRuntimeInZoomForExportedNode(parentExported, oldIdToRuntimeRef);
                if (!parentModel) continue;

                const model = await createRuntimeNodeFromExported(node, parentModel);
                oldIdToRuntimeRef.set(node.id, buildNodeRefFromModel(model));
                reports.createdNodes.push({
                    exported: node,
                    runtime: summarizeModel(model)
                });
                pendingEmbedded.splice(i, 1);
                i -= 1;
                progressed = true;
            }
            if (!progressed) {
                throw new Error(`Could not resolve parent/inzoom chain for embedded nodes: ${pendingEmbedded.map(n => n.label).join(", ")}`);
            }
        }

        for (const node of exportedNodes) {
            const runtimeModel = resolveRuntimeRef(oldIdToRuntimeRef.get(node.id));
            if (!runtimeModel) continue;
            reports.deferredGeometry.node.push(
                await applyNodeGeometry(runtimeModel, node)
            );
        }

        for (const [oldParentId, exportedStates] of stateArraysOf(data)) {
            const parentRef = oldIdToRuntimeRef.get(oldParentId);
            const parentModel = resolveRuntimeRef(parentRef);
            if (!parentModel) {
                throw new Error(`Parent model not found for states: ${oldParentId}`);
            }

            if (!Array.isArray(exportedStates) || !exportedStates.length) continue;

            const labels = exportedStates.map(s => s.label);
            await updateStatesAio(parentModel, labels, {
                removeType: 1,
                deleteDelayMs: 0,
                preferDirectRemove: true
            });

            const refreshedParent = refreshModelRef(parentModel) || parentModel;
            if (getNodeType(refreshedParent) === "opm.Object") {
                try {
                    fitObjectToEmbeddedStatesWithDefaults(refreshedParent);
                } catch {
                }
            }
            const runtimeStates = getStatesByVisualOrder(refreshedParent);
            if (runtimeStates.length !== exportedStates.length) {
                throw new Error(
                    `State count mismatch for ${getLabelFromModel(refreshedParent)}: runtime=${runtimeStates.length}, exported=${exportedStates.length}`
                );
            }

            for (let i = 0; i < exportedStates.length; i++) {
                const exportedState = exportedStates[i];
                const runtimeState = runtimeStates[i];
                oldStateIdToRuntimeRef.set(exportedState.id, buildStateRef(refreshedParent, exportedState.label));
                reports.createdStates.push({
                    exported: exportedState,
                    runtime: summarizeModel(runtimeState)
                });

                reports.deferredGeometry.state.push(
                    await applyStateGeometry(runtimeState, exportedState)
                );
            }
        }

        for (const node of exportedNodes) {
            const runtimeModel = resolveRuntimeRef(oldIdToRuntimeRef.get(node.id));
            if (!runtimeModel) continue;

            if (typeof node.essence === "number" && typeof node.affiliation === "number") {
                const rep = await setEssenceAio(runtimeModel, {
                    essence: node.essence,
                    affiliation: node.affiliation
                });
                reports.essenceApplied.push(rep);
            }
        }

        for (const link of data.proceduralLinks || []) {
            const source = resolveRuntimeRef(oldIdToRuntimeRef.get(link.sourceId) || oldStateIdToRuntimeRef.get(link.sourceId));
            const target = resolveRuntimeRef(oldIdToRuntimeRef.get(link.targetId) || oldStateIdToRuntimeRef.get(link.targetId));

            if (!source || !target) {
                throw new Error(`Missing procedural link endpoint(s) for link ${link.id}`);
            }

            const {created, report} = await addLinkAio(
                source,
                target,
                buildLinkParamsFromProceduralLink(link)
            );

            reports.proceduralLinks.push({
                exported: link,
                runtime: report
            });
        }

        for (const group of data.fundamentalGroups || []) {
            const owner = resolveRuntimeRef(oldIdToRuntimeRef.get(group.ownerId) || oldStateIdToRuntimeRef.get(group.ownerId));

            if (!owner) {
                throw new Error(`Missing owner for fundamental group ${group.triangleId}`);
            }

            const groupReport = {
                group,
                createdMembers: [],
                runtimeTriangleId: null,
                runtimeOwnerLinkId: null
            };

            for (const memberLink of group.memberLinks || []) {
                const target = resolveRuntimeRef(oldIdToRuntimeRef.get(memberLink.targetId) || oldStateIdToRuntimeRef.get(memberLink.targetId));

                if (!target) {
                    throw new Error(
                        `Missing target for fundamental member link ${memberLink.id} in group ${group.triangleId}`
                    );
                }

                const {created, report} = await addLinkAio(
                    owner,
                    target,
                    buildLinkParamsFromFundamentalMember(memberLink)
                );

                groupReport.createdMembers.push({
                    exported: memberLink,
                    runtime: report,
                    runtimeLinkId: created?.id ?? null
                });
            }

            const currentGroups = inspectCurrentFundamentalGroups();
            const ownerId = getIdFromModel(refreshModelRef(owner) || owner);
            const memberTargetIds = new Set((group.memberLinks || []).map(x => {
                const runtimeTarget = resolveRuntimeRef(oldIdToRuntimeRef.get(x.targetId) || oldStateIdToRuntimeRef.get(x.targetId));
                return runtimeTarget ? getIdFromModel(runtimeTarget) : null;
            }).filter(Boolean));
            const runtimeGroup = currentGroups.find(g => {
                const ownerLink = g?.ownerLink?.toJSON?.() || {};
                const currentOwnerId = ownerLink?.source?.id ?? null;
                if (currentOwnerId !== ownerId) return false;
                const currentTargets = new Set((g.memberLinks || []).map(l => l?.toJSON?.()?.target?.id).filter(Boolean));
                if (currentTargets.size !== memberTargetIds.size) return false;
                for (const runtimeTargetId of memberTargetIds) {
                    if (!currentTargets.has(runtimeTargetId)) return false;
                }
                return true;
            }) || null;

            groupReport.runtimeTriangleId = runtimeGroup?.triangleId ?? null;
            groupReport.runtimeOwnerLinkId = runtimeGroup?.ownerLinkId ?? null;
            reports.fundamentalGroups.push(groupReport);
        }

        for (const link of reports.proceduralLinks) {
            reports.deferredGeometry.link.push(
                await applyLinkGeometry(link.runtime.created.id, link.exported.geometry, link.exported)
            );
        }

        for (const groupReport of reports.fundamentalGroups) {
            const affected = [groupReport.runtimeOwnerLinkId, ...groupReport.createdMembers.map(x => x.runtimeLinkId)].filter(Boolean);
            reports.deferredGeometry.triangle.push(
                await applyTriangleGeometry(groupReport.runtimeTriangleId, groupReport.group.triangleGeometry, affected)
            );

            if (groupReport.group.ownerLink?.geometry) {
                reports.deferredGeometry.link.push(
                    await applyLinkGeometry(groupReport.runtimeOwnerLinkId, groupReport.group.ownerLink.geometry, groupReport.group.ownerLink)
                );
            }

            for (const member of groupReport.createdMembers) {
                reports.deferredGeometry.link.push(
                    await applyLinkGeometry(member.runtimeLinkId, member.exported.geometry, member.exported)
                );
            }
        }

        const result = {
            ok: true,
            counts: {
                nodes: reports.createdNodes.length,
                states: reports.createdStates.length,
                proceduralLinks: reports.proceduralLinks.length,
                fundamentalGroups: reports.fundamentalGroups.length
            },
            idMaps: {
                oldNodeIds: [...oldIdToRuntimeRef.keys()],
                oldStateIds: [...oldStateIdToRuntimeRef.keys()]
            },
            reports
        };

        log("importOpdData", result.counts);
        return result;
    }

    async function importEntireOpdTreeAio(data, {
        unfoldDelayMs = 500,
        cleanupGeneratedLinks = true,
        cleanupGeneratedObjects = true
    } = {}) {
        const DATA = data;

        function assert(cond, msg) {
            if (!cond) throw new Error(msg);
        }

        function summarizeModel(model) {
            if (!model) return null;
            return {
                id: getIdFromModel(model),
                type: getNodeType(model),
                label: getLabelFromModel(model),
                position: getPositionFromModel(model),
                logicalLid: model?.getVisual?.()?.logicalElement?.lid ?? null
            };
        }

        function buildNodeRefFromModel(model) {
            const refreshed = refreshModelRef(model) || model;
            return {
                kind: "node",
                nodeType: getNodeType(refreshed),
                label: getLabelFromModel(refreshed)
            };
        }

        function buildStateRef(parentModelOrLabel, stateLabel) {
            const parentLabel = typeof parentModelOrLabel === "string"
                ? parentModelOrLabel
                : getLabelFromModel(refreshModelRef(parentModelOrLabel) || parentModelOrLabel);
            return {
                kind: "state",
                parentLabel,
                label: stateLabel
            };
        }

        function resolveRuntimeRef(ref) {
            if (!ref) return null;
            if (ref.kind === "node") {
                return findCurrentNodeByTypeAndLabel(ref.nodeType, ref.label) || null;
            }
            if (ref.kind === "state") {
                return findCurrentStateByParentLabelAndLabel(ref.parentLabel, ref.label) || null;
            }
            return null;
        }

        function findOpdEntryById(opdId) {
            return (DATA.opds || []).find(x => x?.hierarchy?.opdId === opdId) || null;
        }

        function getChildEntries(parentExportedOpdId) {
            return (DATA.opds || []).filter(
                x => x?.hierarchy?.parentOpdId === parentExportedOpdId && x?.hierarchy?.opdId !== "SD"
            );
        }

        function sortChildrenLikePath(entries) {
            return entries.slice().sort((a, b) => {
                const ap = a?.hierarchy?.opdPath?.length ?? 0;
                const bp = b?.hierarchy?.opdPath?.length ?? 0;
                if (ap !== bp) return ap - bp;
                return String(a?.hierarchy?.opdName ?? "").localeCompare(String(b?.hierarchy?.opdName ?? ""));
            });
        }

        function getStatesArray(entry, exportedParentId) {
            return (entry?.local?.statesByParent?.[exportedParentId] || []).slice().sort((a, b) => {
                const ay = a?.position?.y ?? 0;
                const by = b?.position?.y ?? 0;
                if (ay !== by) return ay - by;
                const ax = a?.position?.x ?? 0;
                const bx = b?.position?.x ?? 0;
                return ax - bx;
            });
        }

        function safeFindCurrentByLabel(label) {
            try {
                return findAnyModelByLabel(label);
            } catch {
                return null;
            }
        }

        const runtimeOpdIdByExportedOpdId = new Map();

        function setRuntimeOpdId(exportedOpdId, runtimeOpdId) {
            runtimeOpdIdByExportedOpdId.set(exportedOpdId, runtimeOpdId);
            return runtimeOpdId;
        }

        function getRuntimeOpdId(exportedOpdId) {
            return runtimeOpdIdByExportedOpdId.get(exportedOpdId) || null;
        }

        function getCurrentRuntimeOpd() {
            return getCurrentOpd() || null;
        }

        async function navigateToRuntimeOpdId(runtimeOpdId) {
            if (!runtimeOpdId) throw new Error("Missing runtime OPD id");
            const rep = navigateToOpdAio(runtimeOpdId, {
                expandParents: true,
                activate: true,
                render: true
            });
            log("importEntireOpdTree.navigateToRuntimeOpdId", rep);
            return rep;
        }

        async function navigateToExportedOpdId(exportedOpdId) {
            const runtimeOpdId = getRuntimeOpdId(exportedOpdId);
            if (!runtimeOpdId) {
                throw new Error(`No runtime OPD id mapped for exported OPD: ${exportedOpdId}`);
            }
            return navigateToRuntimeOpdId(runtimeOpdId);
        }

        async function ensureRuntimeInZoomForExportedNode(node, runtimeRefsByExportedId) {
            const shouldInZoom = !!(
                node && (
                    node.isInZoomContainer === true ||
                    (Array.isArray(node.embeddedThingIds) && node.embeddedThingIds.length > 0)
                )
            );
            if (!shouldInZoom) {
                return resolveRuntimeRef(runtimeRefsByExportedId.get(node?.id));
            }
            let runtime = resolveRuntimeRef(runtimeRefsByExportedId.get(node.id));
            if (!runtime) return null;
            runtime = refreshModelRef(runtime) || runtime;
            const runtimeEmbeddedThingCount = getEmbeddedThingChildren(runtime, {deep: false})
                .filter(c => {
                    const t = getNodeType(c);
                    return t === "opm.Object" || t === "opm.Process";
                }).length;
            if (runtimeEmbeddedThingCount === 0) {
                runtime = await inzoomTargetAio(runtime);
                runtime = refreshModelRef(runtime) || runtime;
                runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(runtime));
            }
            return runtime;
        }

        async function createNodeFromExportedNode(node, parent = null) {
            let model;
            const args = {
                label: node.label,
                x: node.position?.x,
                y: node.position?.y,
                ...(parent ? {parent} : {})
            };
            if (node?.type === "opm.Object") {
                model = await addObjectAio(args);
            } else if (node?.type === "opm.Process") {
                model = await addProcessAio(args);
            } else {
                throw new Error(`Unsupported node type: ${node?.type}`);
            }

            model = refreshModelRef(model) || model;
            if (typeof node?.essence === "number" && typeof node?.affiliation === "number") {
                try {
                    await setEssenceAio(model, {
                        essence: node.essence,
                        affiliation: node.affiliation
                    });
                } catch (e) {
                    log("importEntireOpdTree.setEssence.failed", {label: node.label, error: String(e)});
                }
            }

            return refreshModelRef(model) || model;
        }

        async function ensureStatesForEntry(entry, exportedNodeId, runtimeParentRef) {
            const states = getStatesArray(entry, exportedNodeId);
            if (!states.length) {
                return {
                    exportedStates: [],
                    runtimeStateRefsByExportedId: new Map()
                };
            }

            const parentModel = resolveRuntimeRef(runtimeParentRef);
            if (!parentModel) {
                throw new Error(`Could not resolve runtime parent while normalizing states: ${exportedNodeId}`);
            }

            const labels = states.map(s => s.label);
            await updateStatesAio(parentModel, labels, {
                removeType: 1,
                deleteDelayMs: 0,
                preferDirectRemove: true
            });

            const refreshedParent = refreshModelRef(parentModel) || parentModel;
            const runtimeStates = getStatesByVisualOrder(refreshedParent);
            if (runtimeStates.length !== states.length) {
                throw new Error(
                    `State count mismatch for ${getLabelFromModel(refreshedParent)}: runtime=${runtimeStates.length}, exported=${states.length}`
                );
            }

            const runtimeStateRefsByExportedId = new Map();
            for (let i = 0; i < states.length; i++) {
                runtimeStateRefsByExportedId.set(states[i].id, buildStateRef(refreshedParent, states[i].label));
            }

            return {
                exportedStates: states,
                runtimeStateRefsByExportedId
            };
        }

        async function ensureLocalNodes(entry) {
            const exportedNodes = entry?.local?.nodes || [];
            const runtimeRefsByExportedId = new Map();
            const runtimeStateRefsByExportedId = new Map();

            const topLevelNodes = exportedNodes.filter(n => !n?.parentId);

            for (const node of topLevelNodes) {
                let model = safeFindCurrentByLabel(node.label);
                if (!model) {
                    model = await createNodeFromExportedNode(node, null);
                } else {
                    log("importEntireOpdTree.reuseExistingVisualByLabel", {
                        requested: node.label,
                        runtime: summarizeModel(model)
                    });
                }
                model = refreshModelRef(model) || model;
                runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(model));
            }

            for (const node of topLevelNodes) {
                let runtime = resolveRuntimeRef(runtimeRefsByExportedId.get(node.id));
                if (!runtime) continue;

                const currentLabel = getLabelFromModel(runtime);
                if (currentLabel !== node.label) {
                    await renameNodeAio(runtime, node.label, {onExisting: "useExisting"});
                    runtime = findCurrentNodeByTypeAndLabel(node.type, node.label) || refreshModelRef(runtime) || runtime;
                }

                if (node?.position && typeof node.position.x === "number" && typeof node.position.y === "number") {
                    try {
                        const hasChildren = getEmbeddedThingChildren(runtime, {deep: true}).length > 0;
                        if (hasChildren) {
                            moveAndKeepChildrenPositionByPosition(runtime, node.position.x, node.position.y);
                        } else {
                            runtime.position(node.position.x, node.position.y, {});
                        }
                    } catch {
                    }
                }

                runtime = refreshModelRef(runtime) || runtime;
                runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(runtime));
            }

            for (const node of topLevelNodes) {
                const runtimeRef = runtimeRefsByExportedId.get(node.id);
                if (!runtimeRef) continue;
                const stateInfo = await ensureStatesForEntry(entry, node.id, runtimeRef);
                for (const [exportedStateId, runtimeStateRef] of stateInfo.runtimeStateRefsByExportedId.entries()) {
                    runtimeStateRefsByExportedId.set(exportedStateId, runtimeStateRef);
                }
                const refreshedRuntime = resolveRuntimeRef(runtimeRef);
                if (refreshedRuntime && getNodeType(refreshedRuntime) === "opm.Object") {
                    try {
                        fitObjectToEmbeddedStatesWithDefaults(refreshedRuntime);
                    } catch {
                    }
                    runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(refreshModelRef(refreshedRuntime) || refreshedRuntime));
                }
            }

            return {
                runtimeRefsByExportedId,
                runtimeStateRefsByExportedId
            };
        }

        async function applyInZoomStructuresInCurrentOpd(entry, runtimeRefsByExportedId, runtimeStateRefsByExportedId) {
            const exportedNodes = entry?.local?.nodes || [];
            const exportedNodeById = new Map(exportedNodes.map(n => [n.id, n]));
            const inZoomContainers = exportedNodes.filter(n => !n?.parentId && (n?.isInZoomContainer === true || (Array.isArray(n?.embeddedThingIds) && n.embeddedThingIds.length)));
            const embeddedNodes = exportedNodes.filter(n => !!n?.parentId);

            for (const node of inZoomContainers) {
                await ensureRuntimeInZoomForExportedNode(node, runtimeRefsByExportedId);
            }

            const pendingEmbedded = embeddedNodes.slice();
            while (pendingEmbedded.length) {
                let progressed = false;
                for (let i = 0; i < pendingEmbedded.length; i++) {
                    const node = pendingEmbedded[i];
                    const parentExported = exportedNodeById.get(node.parentId) || null;
                    if (!parentExported) {
                        throw new Error(`Missing exported parent for embedded node ${node.label}`);
                    }
                    let parentRuntime = resolveRuntimeRef(runtimeRefsByExportedId.get(node.parentId));
                    if (!parentRuntime) continue;
                    parentRuntime = await ensureRuntimeInZoomForExportedNode(parentExported, runtimeRefsByExportedId);
                    if (!parentRuntime) continue;

                    let model = safeFindCurrentByLabel(node.label);
                    if (!model) {
                        model = await createNodeFromExportedNode(node, parentRuntime);
                    }
                    model = refreshModelRef(model) || model;

                    if (node?.position && typeof node.position.x === "number" && typeof node.position.y === "number") {
                        try {
                            const hasChildren = getEmbeddedThingChildren(model, {deep: true}).length > 0;
                            if (hasChildren) {
                                moveAndKeepChildrenPositionByPosition(model, node.position.x, node.position.y);
                            } else {
                                model.position(node.position.x, node.position.y, {});
                            }
                        } catch {
                        }
                    }

                    runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(model));

                    const stateInfo = await ensureStatesForEntry(entry, node.id, runtimeRefsByExportedId.get(node.id));
                    for (const [exportedStateId, runtimeStateRef] of stateInfo.runtimeStateRefsByExportedId.entries()) {
                        runtimeStateRefsByExportedId.set(exportedStateId, runtimeStateRef);
                    }

                    const refreshedRuntime = resolveRuntimeRef(runtimeRefsByExportedId.get(node.id));
                    if (refreshedRuntime && getNodeType(refreshedRuntime) === "opm.Object") {
                        try {
                            fitObjectToEmbeddedStatesWithDefaults(refreshedRuntime);
                        } catch {
                        }
                        runtimeRefsByExportedId.set(node.id, buildNodeRefFromModel(refreshModelRef(refreshedRuntime) || refreshedRuntime));
                    }

                    pendingEmbedded.splice(i, 1);
                    i -= 1;
                    progressed = true;
                }
                if (!progressed) {
                    throw new Error(`Could not resolve parent/inzoom chain for embedded nodes: ${pendingEmbedded.map(n => n.label).join(", ")}`);
                }
            }

            return {
                inZoomContainers: inZoomContainers.map(n => n.label),
                embeddedCount: embeddedNodes.length
            };
        }

        function buildProceduralLinkParams(link) {
            return {
                type: link.linkType,
                connection: 0,
                isCondition: false,
                isEvent: false,
                isNegation: false
            };
        }

        function buildFundamentalLinkParams(link) {
            return {
                type: link.linkType,
                connection: 0,
                isCondition: false,
                isEvent: false,
                isNegation: false
            };
        }

        async function rebuildLinks(entry, runtimeRefsByExportedId, runtimeStateRefsByExportedId, {
            doneProceduralIds = new Set(),
            doneFundamentalGroupIds = new Set()
        } = {}) {
            const made = {
                procedural: [],
                fundamental: [],
                fundamentalGroups: [],
                skippedProcedural: [],
                skippedFundamentalGroups: []
            };

            const resolveEndpoint = (exportedId) => {
                return resolveRuntimeRef(runtimeRefsByExportedId.get(exportedId)) ||
                    resolveRuntimeRef(runtimeStateRefsByExportedId.get(exportedId)) ||
                    null;
            };

            for (const link of entry?.local?.proceduralLinks || []) {
                if (doneProceduralIds.has(link.id)) continue;
                const src = resolveEndpoint(link.sourceId);
                const tgt = resolveEndpoint(link.targetId);
                if (!src || !tgt) {
                    made.skippedProcedural.push({
                        exported: link,
                        srcFound: !!src,
                        tgtFound: !!tgt
                    });
                    continue;
                }
                const rep = await addLinkAio(src, tgt, buildProceduralLinkParams(link));
                made.procedural.push({
                    exported: link,
                    runtimeLinkId: rep.created?.id ?? null,
                    report: rep.report
                });
                doneProceduralIds.add(link.id);
            }

            for (const group of entry?.local?.fundamentalGroups || []) {
                if (doneFundamentalGroupIds.has(group.triangleId)) continue;
                const owner = resolveEndpoint(group.ownerId);
                if (!owner) {
                    made.skippedFundamentalGroups.push({
                        exported: group,
                        reason: "missing owner"
                    });
                    continue;
                }

                const expectedTargets = (group.memberLinks || []).map(memberLink => resolveEndpoint(memberLink.targetId));
                if (expectedTargets.some(x => !x)) {
                    made.skippedFundamentalGroups.push({
                        exported: group,
                        reason: "missing member target"
                    });
                    continue;
                }

                const createdMembers = [];
                for (const memberLink of group.memberLinks || []) {
                    const tgt = resolveEndpoint(memberLink.targetId);
                    const rep = await addLinkAio(owner, tgt, buildFundamentalLinkParams(memberLink));
                    createdMembers.push({
                        exported: memberLink,
                        runtimeLinkId: rep.created?.id ?? null,
                        report: rep.report
                    });
                    made.fundamental.push(rep.report);
                }

                const ownerId = getIdFromModel(refreshModelRef(owner) || owner);
                const expectedRuntimeTargets = new Set(expectedTargets.map(t => getIdFromModel(refreshModelRef(t) || t)).filter(Boolean));
                const currentGroups = inspectCurrentFundamentalGroups();
                const runtimeGroup = currentGroups.find(g => {
                    const ownerLink = g?.ownerLink?.toJSON?.() || {};
                    const currentOwnerId = ownerLink?.source?.id ?? null;
                    if (currentOwnerId !== ownerId) return false;
                    const currentTargets = new Set((g.memberLinks || []).map(l => l?.toJSON?.()?.target?.id).filter(Boolean));
                    if (currentTargets.size !== expectedRuntimeTargets.size) return false;
                    for (const id of expectedRuntimeTargets) {
                        if (!currentTargets.has(id)) return false;
                    }
                    return true;
                }) || null;

                made.fundamentalGroups.push({
                    exported: group,
                    runtimeTriangleId: runtimeGroup?.triangleId ?? null,
                    runtimeOwnerLinkId: runtimeGroup?.ownerLinkId ?? null,
                    createdMembers
                });
                doneFundamentalGroupIds.add(group.triangleId);
            }

            return made;
        }

        async function removeAutoScaffoldInCurrentOpd(entry) {
            const contents = listCurrentOpdContents();
            const exportedLabels = new Set((entry?.local?.nodes || []).map(n => n.label).filter(Boolean));
            const ownerLabel = entry?.hierarchy?.opdName ?? null;
            const keepLabels = new Set([...exportedLabels, ownerLabel].filter(Boolean));

            const currentObjects = (contents?.visuals || []).filter(v => /Object|Process/i.test(v?.ctor || ""));
            const toDelete = currentObjects.filter(v => {
                const label = v?.logicalText ?? null;
                if (!label) return false;
                if (keepLabels.has(label)) return false;
                return true;
            });

            const deleted = [];
            for (const item of toDelete) {
                const model = safeFindCurrentByLabel(item.logicalText);
                if (!model) continue;
                try {
                    const rep = await deleteNodeAio(model, {
                        removeType: 1,
                        preferDirectRemove: true,
                        deleteDelayMs: 0
                    });
                    deleted.push(rep);
                } catch (e) {
                    log("importEntireOpdTree.removeAutoScaffold.failed", {
                        label: item.logicalText,
                        error: String(e)
                    });
                }
            }

            log("importEntireOpdTree.removeAutoScaffold", {
                opd: entry?.hierarchy?.opdName,
                keepLabels: [...keepLabels],
                deleted
            });

            return deleted;
        }

        function getFocalLocalNodeInChildEntry(childEntry) {
            const focalLabel = childEntry?.hierarchy?.focalThingLabelInParent;
            if (!focalLabel) return null;
            return (childEntry?.local?.nodes || []).find(n => {
                const t = n?.type;
                return (t === "opm.Object" || t === "opm.Process") && n?.label === focalLabel;
            }) || null;
        }

        function childEntryShouldInZoom(childEntry) {
            const focalLocalNode = getFocalLocalNodeInChildEntry(childEntry);
            if (!focalLocalNode) return false;
            return !!(
                focalLocalNode.isInZoomContainer === true ||
                (Array.isArray(focalLocalNode.embeddedThingIds) && focalLocalNode.embeddedThingIds.length > 0)
            );
        }

        async function expandFromParentIntoChildEntry(childEntry) {
            const focalLabel = childEntry?.hierarchy?.focalThingLabelInParent;
            if (!focalLabel) {
                throw new Error(`Missing focalThingLabelInParent for ${childEntry?.hierarchy?.opdId}`);
            }

            const mode = childEntryShouldInZoom(childEntry) ? "inzoom" : "unfold";

            if (mode === "inzoom") {
                const parentRuntimeOpd = getCurrentRuntimeOpd();
                const rep = await inzoomTargetAio(focalLabel, {delayMs: unfoldDelayMs});
                const now = getCurrentRuntimeOpd();
                if (!now?.id) {
                    throw new Error(`In-zoom did not leave importer on a current runtime OPD for ${focalLabel}`);
                }
                return {
                    mode,
                    runtimeChildOpdId: now.id,
                    runtimeChildOpd: summarizeOpd(now),
                    report: rep,
                    newlyCreated: false,
                    sameRuntimeOpdAsParent: !!(parentRuntimeOpd?.id && parentRuntimeOpd.id === now.id)
                };
            }

            const rep = await unfoldTargetAio(focalLabel, {
                clean: false,
                unfoldDelayMs
            });

            const now = getCurrentRuntimeOpd();
            if (!now?.id) {
                throw new Error(`Unfold did not leave importer on a current runtime OPD for ${focalLabel}`);
            }

            const newlyCreated = !!(rep?.newOpdIds?.length > 0);

            return {
                mode,
                runtimeChildOpdId: now.id,
                runtimeChildOpd: summarizeOpd(now),
                report: rep,
                newlyCreated,
                sameRuntimeOpdAsParent: false
            };
        }

        async function rebuildSingleOpdEntry(entry) {
            const opdName = entry?.hierarchy?.opdName;
            log("importEntireOpdTree.rebuildSingleOpdEntry.start", {
                opdName,
                exportedOpdId: entry?.hierarchy?.opdId,
                exportedParentOpdId: entry?.hierarchy?.parentOpdId,
                runtimeCurrentOpd: summarizeOpd(getCurrentOpd())
            });

            const init = BOOT.capturedUiSeed.init;
            const getCellById = (id) => getCurrentGraphCells().find(c => getIdFromModel(c) === id) || null;
            const refreshLinksByIds = (linkIds) => {
                const links = linkIds.map(id => getCellById(id)).filter(Boolean);
                try {
                    init?.graphService?.updateLinksView?.(links);
                } catch {
                }
                return links;
            };
            const isSelfInvocationExportedLink = (link) => {
                if (!link) return false;
                if (link.linkType === 5) return true;
                const ctor = String(link.ctor || "");
                return /SelfInvocation/i.test(ctor);
            };

            const isSelfInvocationRuntimeLink = (link) => {
                if (!link) return false;
                const ctor = String(link?.constructor?.name || "");
                const logicalType = link?.logicalElement?.linkType ?? null;
                const j = link?.toJSON?.() || {};
                const sid = j?.source?.id ?? null;
                const tid = j?.target?.id ?? null;
                return logicalType === 5 || /SelfInvocation/i.test(ctor) || (!!sid && sid === tid);
            };

            const applyLinkGeometry = (runtimeLinkId, geometry, exportedLink = null) => {
                const link = runtimeLinkId ? getCellById(runtimeLinkId) : null;
                const vertices = Array.isArray(geometry?.vertices) ? geometry.vertices : [];
                if (!link) {
                    return {
                        runtimeId: runtimeLinkId ?? null,
                        applied: false,
                        verticesCount: vertices.length,
                        reason: "runtime link not found"
                    };
                }

                if (isSelfInvocationExportedLink(exportedLink) || isSelfInvocationRuntimeLink(link)) {
                    return {
                        runtimeId: runtimeLinkId,
                        applied: false,
                        skipped: true,
                        reason: "self-invocation geometry replay skipped",
                        verticesCount: vertices.length,
                        ctor: link?.constructor?.name ?? null,
                        linkType: link?.logicalElement?.linkType ?? null
                    };
                }

                if (typeof link.vertices === "function") {
                    link.vertices(vertices);
                } else {
                    link.set("vertices", vertices);
                }
                refreshLinksByIds([runtimeLinkId]);
                return {runtimeId: runtimeLinkId, applied: true, verticesCount: vertices.length};
            };
            const applyTriangleGeometry = (runtimeTriangleId, triangleGeometry, affectedLinkIds = []) => {
                const triangle = runtimeTriangleId ? getCellById(runtimeTriangleId) : null;
                const p = triangleGeometry?.position;
                if (!triangle) return {runtimeId: runtimeTriangleId ?? null, applied: false};
                if (p && typeof p.x === "number" && typeof p.y === "number") {
                    triangle.position(p.x, p.y);
                }
                refreshLinksByIds(affectedLinkIds);
                return {runtimeId: runtimeTriangleId, applied: !!p, position: p || null};
            };

            const {runtimeRefsByExportedId, runtimeStateRefsByExportedId} = await ensureLocalNodes(entry);
            const proceduralDoneIds = new Set();
            const fundamentalDoneIds = new Set();
            const linksBeforeInZoom = await rebuildLinks(entry, runtimeRefsByExportedId, runtimeStateRefsByExportedId, {
                doneProceduralIds: proceduralDoneIds,
                doneFundamentalGroupIds: fundamentalDoneIds
            });
            const inZoom = await applyInZoomStructuresInCurrentOpd(entry, runtimeRefsByExportedId, runtimeStateRefsByExportedId);
            const linksAfterInZoom = await rebuildLinks(entry, runtimeRefsByExportedId, runtimeStateRefsByExportedId, {
                doneProceduralIds: proceduralDoneIds,
                doneFundamentalGroupIds: fundamentalDoneIds
            });
            const links = {
                procedural: [...linksBeforeInZoom.procedural, ...linksAfterInZoom.procedural],
                fundamental: [...linksBeforeInZoom.fundamental, ...linksAfterInZoom.fundamental],
                fundamentalGroups: [...linksBeforeInZoom.fundamentalGroups, ...linksAfterInZoom.fundamentalGroups],
                skippedProcedural: linksAfterInZoom.skippedProcedural,
                skippedFundamentalGroups: linksAfterInZoom.skippedFundamentalGroups,
                phases: {
                    beforeInZoom: linksBeforeInZoom,
                    afterInZoom: linksAfterInZoom
                }
            };

            const geometryReplay = {
                procedural: [],
                fundamental: [],
                triangles: []
            };

            for (const link of links.procedural) {
                geometryReplay.procedural.push(
                    applyLinkGeometry(link.runtimeLinkId, link.exported.geometry, link.exported)
                );
            }

            for (const group of links.fundamentalGroups || []) {
                const affected = [group.runtimeOwnerLinkId, ...group.createdMembers.map(x => x.runtimeLinkId)].filter(Boolean);
                geometryReplay.triangles.push(
                    applyTriangleGeometry(group.runtimeTriangleId, group.exported.triangleGeometry, affected)
                );
                if (group.exported.ownerLink?.geometry) {
                    geometryReplay.fundamental.push(
                        applyLinkGeometry(group.runtimeOwnerLinkId, group.exported.ownerLink.geometry, group.exported.ownerLink)
                    );
                }
                for (const member of group.createdMembers) {
                    geometryReplay.fundamental.push(
                        applyLinkGeometry(member.runtimeLinkId, member.exported.geometry, member.exported)
                    );
                }
            }

            const report = {
                opdName,
                inZoom,
                exportedOpdId: entry?.hierarchy?.opdId,
                runtimeCurrentOpd: summarizeOpd(getCurrentOpd()),
                createdOrMatched: [...runtimeRefsByExportedId.entries()].map(([oldId, ref]) => ({
                    oldId,
                    runtime: summarizeModel(resolveRuntimeRef(ref))
                })),
                links,
                geometryReplay
            };

            log("importEntireOpdTree.rebuildSingleOpdEntry.done", report);
            return {
                runtimeRefsByExportedId,
                runtimeStateRefsByExportedId,
                report
            };
        }

        async function importOpdSubtree(entry) {
            const childEntries = sortChildrenLikePath(getChildEntries(entry.hierarchy.opdId));

            for (const childEntry of childEntries) {
                await navigateToExportedOpdId(entry.hierarchy.opdId);

                const unfoldRep = await expandFromParentIntoChildEntry(childEntry);

                setRuntimeOpdId(childEntry.hierarchy.opdId, unfoldRep.runtimeChildOpdId);

                log("importEntireOpdTree.mapRuntimeOpdId", {
                    exportedOpdId: childEntry.hierarchy.opdId,
                    exportedOpdName: childEntry.hierarchy.opdName,
                    runtimeOpdId: unfoldRep.runtimeChildOpdId,
                    runtimeOpd: unfoldRep.runtimeChildOpd,
                    mode: unfoldRep.mode,
                    sameRuntimeOpdAsParent: unfoldRep.sameRuntimeOpdAsParent
                });

                if (unfoldRep.mode === "unfold" && unfoldRep.newlyCreated) {
                    if (cleanupGeneratedLinks) {
                        await cleanupAllExistingLinksAio();
                    }
                    if (cleanupGeneratedObjects) {
                        await removeAutoScaffoldInCurrentOpd(childEntry);
                    }
                }

                await rebuildSingleOpdEntry(childEntry);
                await importOpdSubtree(childEntry);
            }
        }

        async function rebuildRootSd() {
            const sdEntry = findOpdEntryById("SD");
            if (!sdEntry) throw new Error("No SD entry found in import data");

            await navigateToRuntimeOpdId("SD");
            setRuntimeOpdId("SD", "SD");

            return rebuildSingleOpdEntry(sdEntry);
        }

        assert(DATA && typeof DATA === "object", "Import data object required");
        assert(Array.isArray(DATA.opds), "DATA.opds must be an array");

        await bootstrapRuntimeOnce();

        const overall = {
            startedAt: new Date().toISOString(),
            root: null,
            runtimeOpdIdByExportedOpdId: null,
            completedAt: null
        };

        overall.root = await rebuildRootSd();

        const sdEntry = findOpdEntryById("SD");
        await importOpdSubtree(sdEntry);

        overall.runtimeOpdIdByExportedOpdId =
            Object.fromEntries(runtimeOpdIdByExportedOpdId.entries());

        overall.completedAt = new Date().toISOString();
        log("importEntireOpdTree.done", overall);
        return overall;
    }

    /* -----------------------------
       Cleanup helpers
    ------------------------------*/

    function createNodeFromCtor(Ctor, {label, x, y, parent} = {}) {
        if (!Ctor) throw new Error("Ctor is required");

        const graph =
            BOOT.cachedGraph ||
            BOOT.capturedUiSeed.init?.graph ||
            BOOT.created.object?.graph ||
            BOOT.created.object?.collection?.graph ||
            BOOT.created.object?.collection ||
            BOOT.created.process?.graph ||
            BOOT.created.process?.collection?.graph ||
            BOOT.created.process?.collection;

        if (!graph) throw new Error("No graph available; bootstrap an object or process first");

        const node = new Ctor();
        if (label) {
            setLabelOnModel(node, label);
        }

        const hasParent = !!parent;
        if (hasParent) {
            const parentModel = typeof parent === "string"
                ? getCurrentGraphCells().find(c => getIdFromModel(c) === parent) || findAnyModelByLabel(parent)
                : parent;

            if (!parentModel) {
                throw new Error(`Could not resolve parent: ${parent}`);
            }

            const parentId = getIdFromModel(parentModel);
            if (!parentId) {
                throw new Error("Resolved parent has no ID");
            }

            node.parent(parentId, {});
            parentModel.embed(node, {});
            graph.addCell(node);

            if (typeof x === "number" && typeof y === "number") {
                node.position(x, y, {});
            }
        } else {
            if (typeof x === "number" && typeof y === "number") {
                node.position(x, y);
            }
            graph.addCell(node);
        }

        BOOT.cachedGraph = graph;
        return node;
    }

    function makeInitTempLabel(kind = "object") {
        const rand = (
            (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
                ? globalThis.crypto.randomUUID()
                : `${Date.now()}_${Math.random().toString(36).slice(2)}`
        ).replace(/[^a-zA-Z0-9_-]/g, "_");
        return `__init_${kind}_${rand}`;
    }


    async function bootstrapRuntimeOnce() {
        const hasBoot = (
            !!BOOT.bootConstructors.object &&
            !!BOOT.bootConstructors.process &&
            looksLikeInitRappidService(BOOT.capturedUiSeed.init)
        );

        if (BOOT.bootstrappedOnce && hasBoot) {
            return {
                alreadyBootstrapped: true,
                objectCtor: BOOT.bootConstructors.object,
                processCtor: BOOT.bootConstructors.process,
                initCtor: BOOT.capturedUiSeed.init?.constructor?.name ?? null
            };
        }

        const created = {
            object: null,
            process: null
        };

        let bootObjectTempLabel = null;
        let bootProcessTempLabel = null;

        try {
            created.object = await createSingleObjectFresh();
            if (!created.object) {
                throw new Error("bootstrapRuntimeOnce failed to create bootstrap object");
            }

            bootObjectTempLabel = makeInitTempLabel("object");
            try {
                await renameNodeAio(created.object, bootObjectTempLabel);
            } catch {
            }

            await captureUiSeedFromObject(created.object);
            BOOT.bootConstructors.object = created.object.constructor || BOOT.bootConstructors.object;
            BOOT.cachedGraph = created.object.graph || created.object.collection?.graph || created.object.collection || BOOT.cachedGraph;

            created.process = await createSingleProcessFresh();
            if (!created.process) {
                throw new Error("bootstrapRuntimeOnce failed to create bootstrap process");
            }

            bootProcessTempLabel = makeInitTempLabel("process");
            try {
                await renameNodeAio(created.process, bootProcessTempLabel);
            } catch {
            }

            BOOT.bootConstructors.process = created.process.constructor || BOOT.bootConstructors.process;
            BOOT.cachedGraph = created.process.graph || created.process.collection?.graph || created.process.collection || BOOT.cachedGraph;

            log("bootstrapRuntimeOnce.capturedConstructors", {
                objectCtor: BOOT.bootConstructors.object?.name ?? null,
                processCtor: BOOT.bootConstructors.process?.name ?? null,
                initCtor: BOOT.capturedUiSeed.init?.constructor?.name ?? null,
                bootObjectId: getIdFromModel(created.object),
                bootProcessId: getIdFromModel(created.process),
                bootObjectTempLabel,
                bootProcessTempLabel
            });
        } finally {
            try {
                await cleanupSingleBoot();
            } catch {
            }
            BOOT.created.object = null;
            BOOT.created.process = null;
        }

        if (!BOOT.bootConstructors.object) {
            throw new Error("bootstrapRuntimeOnce did not capture object constructor");
        }
        if (!BOOT.bootConstructors.process) {
            throw new Error("bootstrapRuntimeOnce did not capture process constructor");
        }
        if (!looksLikeInitRappidService(BOOT.capturedUiSeed.init)) {
            throw new Error("bootstrapRuntimeOnce did not capture InitRappidService");
        }

        BOOT.bootstrappedOnce = true;

        return {
            alreadyBootstrapped: false,
            objectCtor: BOOT.bootConstructors.object,
            processCtor: BOOT.bootConstructors.process,
            initCtor: BOOT.capturedUiSeed.init?.constructor?.name ?? null
        };
    }

    async function addObjectAio({label, x, y, parent} = {}) {
        await bootstrapRuntimeOnce();

        const Ctor = BOOT.bootConstructors.object;
        if (!Ctor) throw new Error("No bootstrapped object constructor available");

        const obj = createNodeFromCtor(Ctor, {x, y, parent});
        if (label) {
            await renameNodeAio(obj, label);
        }

        log("addObjectAio", {
            id: getIdFromModel(obj),
            label: getLabelFromModel(obj),
            position: getPositionFromModel(obj),
            parent: obj?.parent?.() ?? obj?.toJSON?.()?.parent ?? null
        });

        return obj;
    }

    async function addProcessAio({label, x, y, parent} = {}) {
        await bootstrapRuntimeOnce();

        const Ctor = BOOT.bootConstructors.process;
        if (!Ctor) throw new Error("No bootstrapped process constructor available");

        const proc = createNodeFromCtor(Ctor, {x, y, parent});
        if (label) {
            await renameNodeAio(proc, label);
        }

        log("addProcessAio", {
            id: getIdFromModel(proc),
            label: getLabelFromModel(proc),
            position: getPositionFromModel(proc),
            parent: proc?.parent?.() ?? proc?.toJSON?.()?.parent ?? null
        });

        return proc;
    }

    async function cleanupSingleBoot(kind = null) {
        const targets = kind ? [kind] : ["process", "object"];
        const removed = [];

        cleanupGhostUi();

        for (const k of targets) {
            const model = BOOT.created[k];
            if (!model) continue;

            try {
                const id = model.get?.("id");
                const rep = await deleteNodeAio(model, {allowRawFallback: false});
                if (!rep.stillOnCanvas) {
                    removed.push({kind: k, id, via: "deleteNodeAio"});
                }
            } catch (e) {
                console.warn(`Failed to cleanup ${k}`, e);
            }

            BOOT.created[k] = null;
        }

        log("cleanupSingleBoot", {removed});
        return removed;
    }

    window.__opcloudSingleBoot = {
        BOOT,
        bootstrapRuntimeOnce,
        cleanupSingleBoot,
        addObjectAio,
        addProcessAio,
        renameNodeAio,
        updateStatesAio,
        setEssenceAio,
        addLinkAio,
        deleteNodeAio,
        inzoomTargetAio,
        unfoldTargetAio,
        navigateToOpdAio,
        navigateToOpdByNamePathAio,
        setCurrentOpdWithoutRenderAio,
        exportCurrentOpdV2,
        exportEntireOpdTree,
        importEntireOpdTreeAio
    };
    console.log("OPCloud single-boot toolkit loaded");
})();

