interface Window {
    ManagedMediaSource: any;
}

enum LogLevel {
    ERROR = 0,
    WARN,
    INFO,
    DEBUG,
    TRACE,
}

let log_pre: HTMLPreElement;
let log_level: LogLevel = LogLevel.ERROR;
let no_log_messages: boolean = true;

let fps_out: HTMLOutputElement;
let frame_count = 0;
let last_fps_calc: number = performance.now();

let check_video: HTMLInputElement;

function run(level: string) {
    window.onload = () => {
        log_pre = document.getElementById("log") as HTMLPreElement;
        log_pre.textContent = "";
        log_level = LogLevel[level];
        fps_out = document.getElementById("fps") as HTMLOutputElement;
        check_video = document.getElementById("enable_video") as HTMLInputElement;
        window.addEventListener("error", (e: ErrorEvent | Event | UIEvent) => {
            if ((e as ErrorEvent).error) {
                let err = e as ErrorEvent;
                log(LogLevel.ERROR, err.filename + ":L" + err.lineno + ":" + err.colno + ": " + err.message + " Error object: " + JSON.stringify(err.error));
            } else if ((e as Event | UIEvent).target) {
                let ev = e as Event;
                let src = (e.target as any).src;
                if (ev.target instanceof HTMLVideoElement)
                    log(LogLevel.ERROR, "Failed to decode video, try reducing resolution or disabling hardware acceleration and reload the page. Error src: " + src);
                else
                    log(LogLevel.ERROR, "Failed to obtain resource, target: " + ev.target + " type: " + ev.type + " src: " + src + " Error object: " + JSON.stringify(ev));
            } else {
                log(LogLevel.WARN, "Got unknown event: " + JSON.stringify(e));
            }
            return false;
        }, true)
        init();
    };
}

function log(level: LogLevel, msg: string) {
    if (level > log_level)
        return;

    if (level == LogLevel.TRACE)
        console.trace(msg);
    else if (level == LogLevel.DEBUG)
        console.debug(msg);
    else if (level == LogLevel.INFO)
        console.info(msg);
    else if (level == LogLevel.WARN)
        console.warn(msg);
    else if (level == LogLevel.ERROR)
        console.error(msg);

    if (no_log_messages) {
        no_log_messages = false;
        document.getElementById("log_section").classList.remove("hide");
    }
    log_pre.textContent += LogLevel[level] + ": " + msg + "\n";
}

function frame_rate_scale(x: number) {
    return Math.pow(x / 100, 1.5);
}

function frame_rate_scale_inv(x: number) {
    return 100 * Math.pow(x, 2 / 3);
}


// frac_w and frac_h are the fraction of the window covered by the video (the tablet area).
function calc_max_video_resolution(scale: number, frac_w: number = 1, frac_h: number = 1) {
    return [
        Math.round(scale * frac_w * window.innerWidth * window.devicePixelRatio),
        Math.round(scale * frac_h * window.innerHeight * window.devicePixelRatio)
    ];
}

function fresh_canvas() {
    let canvas_old = document.getElementById("canvas");
    let canvas = document.createElement("canvas");
    canvas.id = canvas_old.id;
    canvas_old.classList.forEach((cls) => canvas.classList.add(cls));
    // keep the position inside the tablet area
    canvas.style.cssText = canvas_old.style.cssText;
    canvas_old.replaceWith(canvas);
    return canvas;
}

// Rect of the visible picture. If the video is not stretched it is letterboxed inside its
// element, input has to be mapped to the picture and not to the element.
function input_rect(elem: HTMLElement): DOMRect {
    let rect = elem.getBoundingClientRect();
    if (!(elem instanceof HTMLVideoElement) || settings.stretched_video()
        || !elem.videoWidth || !elem.videoHeight)
        return rect;
    let scale = Math.min(rect.width / elem.videoWidth, rect.height / elem.videoHeight);
    let w = elem.videoWidth * scale;
    let h = elem.videoHeight * scale;
    return new DOMRect(rect.left + (rect.width - w) / 2, rect.top + (rect.height - h) / 2, w, h);
}

class Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

class CustomInputAreas {
    mouse: Rect;
    touch: Rect;
    pen: Rect;
}

class MappingBox {
    x: number = 0;
    y: number = 0;
    w: number = 1;
    h: number = 1;
    editing: boolean = false;
    enabled: boolean = true;
    overlay: HTMLDivElement;
    handles: HTMLDivElement[] = [];
    label: HTMLDivElement;
    onUpdate: () => void;
    onDone: () => void;

    constructor(onUpdate: () => void, onDone: () => void) {
        this.onUpdate = onUpdate;
        this.onDone = onDone;
        this.createOverlay();
    }

    getMainRect(): DOMRect {
        return (document.getElementById("main") || document.body).getBoundingClientRect();
    }

    createOverlay() {
        this.overlay = document.createElement("div");
        this.overlay.id = "mapping_overlay";
        this.overlay.className = "hidden";

        this.label = document.createElement("div");
        this.label.id = "mapping_label";
        this.overlay.appendChild(this.label);

        const done = document.createElement("button");
        done.id = "mapping_done";
        done.textContent = "Done";
        done.onclick = (e) => { e.stopPropagation(); this.onDone(); };
        this.overlay.appendChild(done);

        for (const pos of ["tl", "tr", "bl", "br"]) {
            const handle = document.createElement("div");
            handle.className = `mapping_handle ${pos}`;
            this.overlay.appendChild(handle);
            this.handles.push(handle);
            this.initHandleDrag(handle, pos);
        }

        this.initBoxDrag();
        // Append to main so it is positioned within the input area
        const main = document.getElementById("main") || document.body;
        main.appendChild(this.overlay);
    }

    describe(): string {
        const pct = (v: number) => (v * 100).toFixed(1).padStart(5) + "%";
        return `X ${pct(this.x)}   Y ${pct(this.y)}\nW ${pct(this.w)}   H ${pct(this.h)}`;
    }

    updateDOM() {
        const video = document.getElementById("video");
        const canvas = document.getElementById("canvas");

        if (!this.enabled) {
            this.overlay.className = "hidden";
        } else if (this.editing) {
            this.overlay.className = "editing";
        } else {
            this.overlay.className = "not-editing";
            if (video.classList.contains("vanish"))
                this.overlay.classList.add("no-video");
        }

        // Position relative to the main element, which covers the whole window
        const [x, y, w, h] = this.enabled ? [this.x, this.y, this.w, this.h] : [0, 0, 1, 1];
        for (const elem of [this.overlay, video, canvas]) {
            elem.style.left = `${x * 100}%`;
            elem.style.top = `${y * 100}%`;
            elem.style.width = `${w * 100}%`;
            elem.style.height = `${h * 100}%`;
        }

        this.label.textContent = this.describe();
        this.handles.forEach(h => h.classList.toggle("hidden", !this.editing));
    }

    initBoxDrag() {
        let startX = 0, startY = 0;
        let startBoxX = 0, startBoxY = 0;

        const onPointerDown = (e: PointerEvent) => {
            if (e.target !== this.overlay) return;
            e.stopPropagation();
            this.overlay.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            startBoxX = this.x;
            startBoxY = this.y;
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!this.overlay.hasPointerCapture(e.pointerId)) return;
            e.stopPropagation();
            const rect = this.getMainRect();
            const dx = (e.clientX - startX) / rect.width;
            const dy = (e.clientY - startY) / rect.height;

            this.x = Math.max(0, Math.min(1 - this.w, startBoxX + dx));
            this.y = Math.max(0, Math.min(1 - this.h, startBoxY + dy));
            this.updateDOM();
            this.onUpdate();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (this.overlay.hasPointerCapture(e.pointerId)) {
                this.overlay.releasePointerCapture(e.pointerId);
            }
        };

        this.overlay.addEventListener("pointerdown", onPointerDown);
        this.overlay.addEventListener("pointermove", onPointerMove);
        this.overlay.addEventListener("pointerup", onPointerUp);
        this.overlay.addEventListener("pointercancel", onPointerUp);
    }

    initHandleDrag(handle: HTMLDivElement, position: string) {
        let startX = 0, startY = 0;
        let startXVal = 0, startYVal = 0;
        let startWVal = 0, startHVal = 0;

        const onPointerDown = (e: PointerEvent) => {
            e.stopPropagation();
            handle.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            startXVal = this.x;
            startYVal = this.y;
            startWVal = this.w;
            startHVal = this.h;
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!handle.hasPointerCapture(e.pointerId)) return;
            e.stopPropagation();
            const rect = this.getMainRect();
            const dx = (e.clientX - startX) / rect.width;
            const dy = (e.clientY - startY) / rect.height;

            let newX = this.x;
            let newY = this.y;
            let newW = this.w;
            let newH = this.h;

            if (position.includes("l")) {
                newX = Math.max(0, Math.min(startXVal + startWVal - 0.05, startXVal + dx));
                newW = startWVal - (newX - startXVal);
            } else if (position.includes("r")) {
                newW = Math.max(0.05, Math.min(1 - this.x, startWVal + dx));
            }

            if (position.includes("t")) {
                newY = Math.max(0, Math.min(startYVal + startHVal - 0.05, startYVal + dy));
                newH = startHVal - (newY - startYVal);
            } else if (position.includes("b")) {
                newH = Math.max(0.05, Math.min(1 - this.y, startHVal + dy));
            }

            this.x = newX;
            this.y = newY;
            this.w = newW;
            this.h = newH;
            this.updateDOM();
            this.onUpdate();
        };

        const onPointerUp = (e: PointerEvent) => {
            if (handle.hasPointerCapture(e.pointerId)) {
                handle.releasePointerCapture(e.pointerId);
            }
        };

        handle.addEventListener("pointerdown", onPointerDown);
        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
    }
}

class Settings {
    webSocket: WebSocket;
    checks: Map<string, HTMLInputElement>;
    capturable_select: HTMLSelectElement;
    frame_rate_input: HTMLInputElement;
    frame_rate_output: HTMLOutputElement;
    scale_video_input: HTMLInputElement;
    scale_video_output: HTMLOutputElement;
    range_min_pressure: HTMLInputElement;
    min_pressure_output: HTMLOutputElement;
    check_aggressive_seek: HTMLInputElement;
    client_name_input: HTMLInputElement;
    visible: boolean;
    custom_input_areas: CustomInputAreas;
    settings: HTMLElement;
    mappingBox: MappingBox;
    mapping_presets: { [name: string]: Rect } = {};
    preset_select: HTMLSelectElement;
    save_preset_btn: HTMLButtonElement;
    delete_preset_btn: HTMLButtonElement;
    toggle_edit_btn: HTMLButtonElement;
    mapping_info: HTMLOutputElement;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;
        this.checks = new Map<string, HTMLInputElement>();
        this.capturable_select = document.getElementById("window") as HTMLSelectElement;
        this.frame_rate_input = document.getElementById("frame_rate") as HTMLInputElement;
        this.frame_rate_input.min = frame_rate_scale_inv(0).toString();
        this.frame_rate_input.max = frame_rate_scale_inv(120).toString();
        this.frame_rate_output = document.getElementById("frame_rate_value") as HTMLOutputElement;
        this.scale_video_input = document.getElementById("scale_video") as HTMLInputElement;
        this.scale_video_output = document.getElementById("scale_video_value") as HTMLOutputElement;
        this.range_min_pressure = document.getElementById("min_pressure") as HTMLInputElement;
        this.min_pressure_output = document.getElementById("min_pressure_value") as HTMLOutputElement;
        this.client_name_input = document.getElementById("client_name") as HTMLInputElement;
        this.frame_rate_input.oninput = () => this.update_frame_rate_output();
        this.scale_video_input.oninput = () => this.update_scale_video_output();
        this.range_min_pressure.oninput = () => this.update_min_pressure_output();
        this.visible = true;

        // Settings UI
        this.settings = document.getElementById("settings");
        this.settings.onclick = (e) => e.stopPropagation();
        let handle = document.getElementById("handle");

        // Settings elements
        this.settings.querySelectorAll("input[type=checkbox]").forEach(
            (elem, _key, _parent) => this.checks.set(elem.id, elem as HTMLInputElement)
        );

        // Tablet area
        this.preset_select = document.getElementById("mapping_preset") as HTMLSelectElement;
        this.save_preset_btn = document.getElementById("save_mapping_preset") as HTMLButtonElement;
        this.delete_preset_btn = document.getElementById("delete_mapping_preset") as HTMLButtonElement;
        this.toggle_edit_btn = document.getElementById("toggle_mapping_edit") as HTMLButtonElement;
        this.mapping_info = document.getElementById("mapping_info") as HTMLOutputElement;

        this.mappingBox = new MappingBox(() => {
            // the area is being dragged, keep the selected preset in sync
            const name = this.preset_select.value;
            if (this.is_preset(name))
                this.mapping_presets[name] = this.mapping_rect();
            else
                this.preset_select.value = "__custom";
            this.update_mapping_info();
            this.save_settings();
        }, () => this.set_mapping_editing(false));

        this.load_settings();
        this.mappingBox.updateDOM();

        // event handling

        // client only
        handle.onclick = () => { this.toggle() };
        this.checks.get("lefty").onchange = (e) => {
            this.settings.classList.toggle("lefty", (e.target as HTMLInputElement).checked);
            this.save_settings();
        }

        document.getElementById("vanish").onclick = () => {
            this.settings.classList.add("vanish");
        }

        this.checks.get("stretch").onchange = () => {
            stretch_video();
            this.save_settings();
        };

        this.checks.get("enable_debug_overlay").onchange = (e) => {
            debug_overlay.classList.toggle("hide", !(e.target as HTMLInputElement).checked);
            this.save_settings();
        };

        this.check_aggressive_seek = this.checks.get("aggressive_seeking");
        this.check_aggressive_seek.onchange = () => {
            this.save_settings();
        };

        this.checks.get("enable_video").onchange = (e) => {
            let enabled = (e.target as HTMLInputElement).checked;
            document.getElementById("video").classList.toggle("vanish", !enabled);
            document.getElementById("canvas").classList.toggle("vanish", enabled);
            this.mappingBox.updateDOM();
            this.save_settings();
            if (enabled) {
                this.webSocket.send('"ResumeVideo"');
            } else {
                this.webSocket.send('"PauseVideo"');
            }
        }

        let upd_pointer = () => {
            this.save_settings();
            new PointerHandler(this.webSocket);
        }
        this.checks.get("enable_mouse").onchange = upd_pointer;
        this.checks.get("enable_stylus").onchange = upd_pointer;
        this.checks.get("enable_touch").onchange = upd_pointer;

        this.checks.get("energysaving").onchange = (e) => {
            this.save_settings();
            this.toggle_energysaving((e.target as HTMLInputElement).checked);
        };

        this.checks.get("enable_custom_input_areas").onchange = () => {
            this.save_settings();
        };

        // Tablet area controls
        this.checks.get("enable_mapping").onchange = (e) => {
            this.mappingBox.enabled = (e.target as HTMLInputElement).checked;
            if (!this.mappingBox.enabled && this.mappingBox.editing)
                this.set_mapping_editing(false);
            this.on_mapping_changed();
        };

        this.toggle_edit_btn.onclick = () => this.set_mapping_editing(!this.mappingBox.editing);

        this.preset_select.onchange = () => {
            const name = this.preset_select.value;
            if (name === "__full")
                this.set_mapping_rect({ x: 0, y: 0, w: 1, h: 1 });
            else if (this.is_preset(name))
                this.set_mapping_rect(this.mapping_presets[name]);
            this.delete_preset_btn.disabled = !this.is_preset(name);
            this.on_mapping_changed();
        };

        this.save_preset_btn.onclick = () => {
            const current = this.is_preset(this.preset_select.value) ? this.preset_select.value : "";
            const name = window.prompt("Preset name:", current);
            if (!name || name.startsWith("__"))
                return;
            this.mapping_presets[name] = this.mapping_rect();
            this.rebuild_preset_select(name);
            this.save_settings();
        };

        this.delete_preset_btn.onclick = () => {
            const name = this.preset_select.value;
            if (this.is_preset(name) && window.confirm(`Delete preset "${name}"?`)) {
                delete this.mapping_presets[name];
                this.rebuild_preset_select("__custom");
                this.save_settings();
            }
        };

        this.range_min_pressure.onchange = () => this.save_settings();

        // server
        let upd_server_config = () => { this.save_settings(); this.send_server_config() };
        this.checks.get("uinput_support").onchange = upd_server_config;
        this.checks.get("capture_cursor").onchange = upd_server_config;
        this.scale_video_input.onchange = upd_server_config;
        this.client_name_input.onchange = upd_server_config;
        this.frame_rate_input.onchange = upd_server_config;

        document.getElementById("refresh").onclick = () => this.webSocket.send('"GetCapturableList"');
        document.getElementById("custom_input_areas").onclick = () => {
            this.webSocket.send('"ChooseCustomInputAreas"');
        };
        this.capturable_select.onchange = () => this.send_server_config();
    }

    send_server_config() {
        let config = new Object(null);
        config["capturable_id"] = Number(this.capturable_select.value);
        for (const key of [
            "uinput_support",
            "capture_cursor"])
            config[key] = this.checks.get(key).checked;
        let [w, h] = this.max_video_resolution();
        config["max_width"] = w;
        config["max_height"] = h;
        config["frame_rate"] = frame_rate_scale(this.frame_rate_input.valueAsNumber);
        if (this.client_name_input.value)
            config["client_name"] = this.client_name_input.value;
        this.webSocket.send(JSON.stringify({ "Config": config }));
    }

    // The video only covers the tablet area, so there is no need to stream more pixels.
    max_video_resolution() {
        let box = this.mappingBox;
        if (box && box.enabled)
            return calc_max_video_resolution(this.scale_video_input.valueAsNumber, box.w, box.h);
        return calc_max_video_resolution(this.scale_video_input.valueAsNumber);
    }

    update_scale_video_output() {
        let [w, h] = this.max_video_resolution();
        this.scale_video_output.value = w + "×" + h;
    }

    update_frame_rate_output() {
        this.frame_rate_output.value = Math.round(frame_rate_scale(this.frame_rate_input.valueAsNumber)) + " fps";
    }

    update_min_pressure_output() {
        this.min_pressure_output.value = Math.round(this.range_min_pressure.valueAsNumber * 100) + "%";
    }

    is_preset(name: string): boolean {
        return !name.startsWith("__") && Object.prototype.hasOwnProperty.call(this.mapping_presets, name);
    }

    mapping_rect(): Rect {
        return { x: this.mappingBox.x, y: this.mappingBox.y, w: this.mappingBox.w, h: this.mappingBox.h };
    }

    set_mapping_rect(r: Rect) {
        this.mappingBox.x = r.x;
        this.mappingBox.y = r.y;
        this.mappingBox.w = r.w;
        this.mappingBox.h = r.h;
    }

    // Called once the tablet area has been changed (not while dragging).
    on_mapping_changed() {
        this.mappingBox.updateDOM();
        this.update_mapping_info();
        this.update_scale_video_output();
        this.save_settings();
        if (this.webSocket.readyState == WebSocket.OPEN)
            this.send_server_config();
    }

    set_mapping_editing(editing: boolean) {
        this.mappingBox.editing = editing;
        if (editing) {
            this.mappingBox.enabled = true;
            this.checks.get("enable_mapping").checked = true;
            // get the panel out of the way
            this.set_visible(false);
        }
        this.toggle_edit_btn.textContent = editing ? "Done" : "Edit Area";
        this.on_mapping_changed();
    }

    update_mapping_info() {
        this.mapping_info.value = this.mappingBox.describe();
    }

    rebuild_preset_select(selected: string) {
        this.preset_select.textContent = "";
        const add = (value: string, text: string) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = text;
            this.preset_select.appendChild(opt);
        };
        add("__full", "Full screen");
        for (const name of Object.keys(this.mapping_presets))
            add(name, name);
        add("__custom", "Custom");
        this.preset_select.value = (selected === "__full" || this.is_preset(selected)) ? selected : "__custom";
        this.delete_preset_btn.disabled = !this.is_preset(this.preset_select.value);
    }

    save_settings() {
        let settings = Object(null);
        for (const [key, elem] of this.checks.entries())
            settings[key] = elem.checked;
        settings["frame_rate"] = frame_rate_scale(this.frame_rate_input.valueAsNumber).toString();
        settings["scale_video"] = this.scale_video_input.value;
        settings["min_pressure"] = this.range_min_pressure.value;
        settings["custom_input_areas"] = this.custom_input_areas;
        settings["client_name"] = this.client_name_input.value;
        settings["mapping_box"] = this.mapping_rect();
        settings["mapping_presets"] = this.mapping_presets;
        settings["mapping_active_preset"] = this.preset_select.value;
        localStorage.setItem("settings", JSON.stringify(settings));
    }

    load_settings() {
        let settings = null;
        try {
            settings = JSON.parse(localStorage.getItem("settings"));
        } catch (e) {
            log(LogLevel.DEBUG, "Failed to load settings: " + e);
        }
        if (!settings) {
            this.frame_rate_input.value = frame_rate_scale_inv(30).toString();
            this.load_mapping(null);
            this.update_outputs();
            return;
        }
        try {
            for (const [key, elem] of this.checks.entries()) {
                if (typeof settings[key] === "boolean")
                    elem.checked = settings[key];
            }
            let upd_limit = settings["frame_rate"];
            if (upd_limit)
                this.frame_rate_input.value = frame_rate_scale_inv(upd_limit).toString();
            else
                this.frame_rate_input.value = frame_rate_scale_inv(30).toString();

            let scale_video = settings["scale_video"];
            if (scale_video)
                this.scale_video_input.value = scale_video;

            let min_pressure = settings["min_pressure"];
            if (min_pressure)
                this.range_min_pressure.value = min_pressure;

            this.custom_input_areas = settings["custom_input_areas"];

            if (this.checks.get("lefty").checked) {
                this.settings.classList.add("lefty");
            }

            if (!this.checks.get("enable_video").checked || this.checks.get("energysaving").checked) {
                this.checks.get("enable_video").checked = false;
                if (this.checks.get("energysaving").checked)
                    this.checks.get("enable_video").disabled = true;
                document.getElementById("video").classList.add("vanish");
                document.getElementById("canvas").classList.remove("vanish");
            }

            if (this.checks.get("energysaving").checked) {
                this.toggle_energysaving(true);
            }

            if (this.checks.get("enable_debug_overlay").checked) {
                debug_overlay.classList.remove("hide");
            }

            if (document.getElementById("custom_input_areas").classList.contains("hide")) {
                this.checks.get("enable_custom_input_areas").checked = false;
            }

            let client_name = settings["client_name"];
            if (client_name)
                this.client_name_input.value = client_name;

            this.load_mapping(settings);
        } catch (e) {
            log(LogLevel.DEBUG, "Failed to load settings: " + e);
        }
        this.update_outputs();
    }

    load_mapping(settings: any) {
        const valid = (r: any) => r && [r.x, r.y, r.w, r.h].every((v) => typeof v === "number");
        this.mapping_presets = {};
        let presets = settings && settings["mapping_presets"];
        if (presets) {
            for (const name of Object.keys(presets))
                if (valid(presets[name]))
                    this.mapping_presets[name] = presets[name];
        }
        if (settings && valid(settings["mapping_box"]))
            this.set_mapping_rect(settings["mapping_box"]);
        this.mappingBox.enabled = this.checks.get("enable_mapping").checked;
        this.rebuild_preset_select(settings && settings["mapping_active_preset"] || "__full");
    }

    update_outputs() {
        this.update_frame_rate_output();
        this.update_scale_video_output();
        this.update_min_pressure_output();
        this.update_mapping_info();
    }

    stretched_video() {
        return this.checks.get("stretch").checked
    }

    pointer_types() {
        let ptrs = [];
        if (this.checks.get("enable_mouse").checked)
            ptrs.push("mouse");
        if (this.checks.get("enable_stylus").checked)
            ptrs.push("pen");
        if (this.checks.get("enable_touch").checked)
            ptrs.push("touch");
        return ptrs;
    }

    toggle() {
        this.set_visible(!this.visible);
    }

    set_visible(visible: boolean) {
        this.settings.classList.toggle("hide", !visible);
        this.visible = visible;
    }

    onCapturableList(window_names: string[]) {
        let current_selection = undefined;
        if (this.capturable_select.selectedOptions[0])
            current_selection = this.capturable_select.selectedOptions[0].textContent;
        let new_index: number;
        this.capturable_select.innerText = "";
        window_names.forEach((name, i) => {
            let option = document.createElement("option");
            option.value = String(i);
            option.innerText = name;
            this.capturable_select.appendChild(option);
            if (name === current_selection)
                new_index = i;
        });
        if (new_index !== undefined)
            this.capturable_select.value = String(new_index);
        else if (current_selection)
            // Can't find the window, so don't select anything
            this.capturable_select.value = "";
    }

    toggle_energysaving(energysaving: boolean) {
        let canvas = fresh_canvas();
        if (energysaving) {
            let ctx = canvas.getContext("2d");
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (energysaving) {
            this.checks.get("enable_video").checked = false;
            this.checks.get("enable_video").disabled = true;
            this.checks.get("enable_video").dispatchEvent(new Event("change"));
        } else
            this.checks.get("enable_video").disabled = false;
        if (settings)
            new PointerHandler(this.webSocket);
    }

    video_enabled(): boolean {
        return this.checks.get("enable_video").checked;
    }
}

let settings: Settings;
let debug_overlay: HTMLElement;
let last_pointer_data: Object;

class PEvent {
    event_type: string;
    pointer_id: number;
    timestamp: number;
    is_primary: boolean;
    pointer_type: string;
    button: number;
    buttons: number;
    x: number;
    y: number;
    // movement_x: number;
    // movement_y: number;
    pressure: number;
    tilt_x: number;
    tilt_y: number;
    twist: number;
    width: number;
    height: number;

    constructor(eventType: string, event: PointerEvent, targetRect: DOMRect) {
        let diag_len = Math.sqrt(targetRect.width * targetRect.width + targetRect.height * targetRect.height)
        this.event_type = eventType.toString();
        this.pointer_id = event.pointerId;
        this.timestamp = Math.round(event.timeStamp * 1000);
        this.is_primary = event.isPrimary;
        this.pointer_type = event.pointerType;
        let btn = event.button;
        // for some reason the secondary and auxiliary buttons are ordered differently for
        // the button and buttons properties
        if (btn == 2)
            btn = 1;
        else if (btn == 1)
            btn = 2;
        this.button = (btn < 0 ? 0 : 1 << btn);
        this.buttons = event.buttons;
        // pointer capture can report positions outside of the tablet area
        let px = Math.min(Math.max((event.clientX - targetRect.left) / targetRect.width, 0), 1);
        let py = Math.min(Math.max((event.clientY - targetRect.top) / targetRect.height, 0), 1);

        let x_offset = 0;
        let y_offset = 0;
        let x_scale = 1;
        let y_scale = 1;
        if (settings.checks.get("enable_custom_input_areas").checked) {
            let custom_input_area: Rect = null;
            if (event.pointerType == "mouse") {
                custom_input_area = settings.custom_input_areas.mouse;
            } else if (event.pointerType == "touch") {
                custom_input_area = settings.custom_input_areas.touch;
            } else if (event.pointerType == "pen") {
                custom_input_area = settings.custom_input_areas.pen;
            }
            if (custom_input_area) {
                x_scale = custom_input_area.w;
                y_scale = custom_input_area.h;
                x_offset = custom_input_area.x;
                y_offset = custom_input_area.y;
            }
        }
        this.x = px * x_scale + x_offset;
        this.y = py * y_scale + y_offset;
        // this.movement_x = event.movementX ? event.movementX : 0;
        // this.movement_y = event.movementY ? event.movementY : 0;
        this.pressure = Math.max(event.pressure, settings.range_min_pressure.valueAsNumber);
        this.tilt_x = event.tiltX;
        this.tilt_y = event.tiltY;
        this.width = event.width / diag_len;
        this.height = event.height / diag_len;
        this.twist = event.twist;
    }
}

class WEvent {
    dx: number;
    dy: number;
    timestamp: number;

    constructor(event: WheelEvent) {
        /* The WheelEvent can have different scrolling modes that affect how much scrolling
         * should be done. Unfortunately there is not always a way to accurately convert the scroll
         * distance into pixels. Thus the following is a guesstimate and scales the WheelEvent's
         * deltaX/Y values accordingly.
         */
        let scale = 1;
        switch (event.deltaMode) {
            case 0x01: // DOM_DELTA_LINE
                scale = 10;
                break;
            case 0x02: // DOM_DELTA_PAGE
                scale = 1000;
                break;
            default: // DOM_DELTA_PIXEL
        }
        this.dx = Math.round(scale * event.deltaX);
        this.dy = Math.round(scale * event.deltaY);
        this.timestamp = Math.round(event.timeStamp * 1000);
    }
}

// in milliseconds
const fade_time = 5000;

const vs_source = `
  attribute vec3 aVertex;
  uniform float uTime;
  varying lowp vec4 vColor;

  void main() {
    float dt = uTime - aVertex[2];
    gl_Position = vec4(aVertex[0], aVertex[1], 1.0, 1.0);
    vColor = vec4(0.0, 170.0/255.0, 1.0, 1.0) * max(1.0 - dt/${fade_time}.0, 0.0);
  }
`;

const fs_source = `
  varying lowp vec4 vColor;

  void main() {
    gl_FragColor = vColor;
  }
`;

class Painter {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;

    /* Store lines currently being drawn.
     *
     * Keys are pointerIds, values are an array of the last position (x, y), thickness and event
     * time and another array with vertices to be used by webgl. Each vertex is made of 3 floats, x
     * and y coordinates and the event time. Vertices always come in pairs of two. Two such vertices
     * describe the edges of the line to be drawn with regard to it's thickness. TRIANGLE_STRIP is
     * then used to connect them and draw an actual line with some thickness depending on the
     * pressure applied.
     */
    lines_active: Map<number, [[number, number, number, number], number[]]>

    // Array of vertices that are not actively drawn anymore and do not need updates, except
    // removing them after they faded away.
    lines_old: number[][];
    vertex_attr: GLint;
    vertex_buffer: WebGLBuffer;
    time_attr: WebGLUniformLocation;
    initialized: boolean;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.syncSize();
        this.gl = canvas.getContext("webgl");
        if (this.gl) {
            this.lines_active = new Map();
            this.lines_old = [];
            this.setupWebGL();
        }
    }

    // The canvas covers the tablet area which may be resized at any time, so keep its
    // resolution in sync with its size on screen.
    syncSize() {
        let w = Math.round(this.canvas.clientWidth * window.devicePixelRatio);
        let h = Math.round(this.canvas.clientHeight * window.devicePixelRatio);
        if (w > 0 && h > 0 && (this.canvas.width != w || this.canvas.height != h)) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    loadShader(type, source): WebGLShader {
        let gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            log(LogLevel.WARN, "Failed to compile shaders: " + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    setupWebGL() {
        let gl = this.gl;
        gl.enable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const vertex_shader = this.loadShader(gl.VERTEX_SHADER, vs_source);
        const fragment_shader = this.loadShader(gl.FRAGMENT_SHADER, fs_source);
        if (!vertex_shader || !fragment_shader)
            return;
        const shader_program = gl.createProgram();
        gl.attachShader(shader_program, vertex_shader);
        gl.attachShader(shader_program, fragment_shader);
        gl.linkProgram(shader_program);

        if (!gl.getProgramParameter(shader_program, gl.LINK_STATUS)) {
            log(LogLevel.WARN, "Unable to initialize the shader program: " + gl.getProgramInfoLog(shader_program));
            return;
        }
        this.vertex_attr = gl.getAttribLocation(shader_program, "aVertex");
        this.time_attr = gl.getUniformLocation(shader_program, "uTime");
        this.vertex_buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
        gl.vertexAttribPointer(this.vertex_attr, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.vertex_attr);
        gl.useProgram(shader_program);
        this.initialized = true;
        requestAnimationFrame(() => this.render());
    }

    render() {
        // only do work if necessary
        if (!check_video.checked && (this.lines_active.size > 0 || this.lines_old.length > 0)) {
            if (this.lines_old.length > 0) {
                if (performance.now() - this.lines_old[0][this.lines_old[0].length - 1] > fade_time)
                    this.lines_old.shift();
            }
            let gl = this.gl;
            this.syncSize();
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(this.time_attr, performance.now());
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
            for (let vertices of this.lines_old) {
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 3)
            }
            for (let [_, vertices] of this.lines_active.values()) {
                // sometimes there are no linesegments because there has been only a single
                // PointerEvent
                if (vertices.length == 0)
                    continue;
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 3)
            }
        }
        requestAnimationFrame(() => this.render());
    }

    appendEventToLine(event: PointerEvent) {
        let line = this.lines_active.get(event.pointerId);
        if (!line) {
            line = [null, []];
            this.lines_active.set(event.pointerId, line)
        }
        this.syncSize();
        let max_pixels = Math.max(this.canvas.width, this.canvas.height);
        let rect = this.canvas.getBoundingClientRect();
        let x = (event.clientX - rect.left) / rect.width * 2 - 1;
        let y = 1 - (event.clientY - rect.top) / rect.height * 2;
        let delta = event.pressure + 0.4;
        let t = performance.now();
        // to draw a line segment, there has to be some previous position
        if (line[0]) {
            let [x0, y0, delta0, t0] = line[0];
            // get vector perpendicular to the linesegment to calculate quadrangel around the
            // segment with appropriate thickness
            let dx = (y - y0);
            let dy = -(x - x0);
            let dd = Math.sqrt(dx ** 2 + dy ** 2);
            if (dd == 0) {
                return;
            }
            dx = dx / dd * max_pixels / this.canvas.width * 0.004;
            dy = dy / dd * max_pixels / this.canvas.height * 0.004;

            if (line[1].length == 0)
                line[1].push(
                    x0 + delta0 * dx, y0 + delta0 * dy, t0, x0 - delta0 * dx, y0 - delta0 * dy, t0,
                );
            line[1].push(
                x + delta * dx, y + delta * dy, t, x - delta * dx, y - delta * dy, t
            )
        }
        line[0] = [x, y, delta, t];
    }

    onstart(event: PointerEvent) {
        this.appendEventToLine(event);
    }

    onmove(event: PointerEvent) {
        if (this.lines_active.has(event.pointerId)) {
            const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
            for (const e of events) {
                this.appendEventToLine(e);
            }
        }
    }

    onstop(event: PointerEvent) {
        let lines = this.lines_active.get(event.pointerId);
        if (lines) {
            if (lines[1].length > 0)
                this.lines_old.push(lines[1]);
            this.lines_active.delete(event.pointerId);
        }
    }
}

class PointerHandler {
    webSocket: WebSocket;
    pointerTypes: string[];

    constructor(webSocket: WebSocket) {
        let video = document.getElementById("video");
        let canvas = document.getElementById("canvas");
        this.webSocket = webSocket;
        this.pointerTypes = settings.pointer_types();

        video.onpointerdown = (e) => this.onEvent(e, "pointerdown");
        video.onpointerup = (e) => this.onEvent(e, "pointerup");
        video.onpointercancel = (e) => this.onEvent(e, "pointercancel");
        video.onpointermove = (e) => this.onEvent(e, "pointermove");
        video.onpointerout = (e) => this.onEvent(e, "pointerout");
        video.onpointerleave = (e) => this.onEvent(e, "pointerleave");
        video.onpointerenter = (e) => this.onEvent(e, "pointerenter");
        video.onpointerover = (e) => this.onEvent(e, "pointerover");

        let painter: Painter;
        if (!settings.checks.get("energysaving").checked)
            painter = new Painter(canvas as HTMLCanvasElement);

        if (painter && painter.initialized) {
            canvas.onpointerdown = (e) => { this.onEvent(e, "pointerdown"); painter.onstart(e); };
            canvas.onpointerup = (e) => { this.onEvent(e, "pointerup"); painter.onstop(e); };
            canvas.onpointercancel = (e) => { this.onEvent(e, "pointercancel"); painter.onstop(e); };
            canvas.onpointermove = (e) => { this.onEvent(e, "pointermove"); painter.onmove(e); };
            canvas.onpointerout = (e) => { this.onEvent(e, "pointerout"); painter.onstop(e); };
            canvas.onpointerleave = (e) => { this.onEvent(e, "pointerleave"); painter.onstop(e); };
            canvas.onpointerenter = (e) => { this.onEvent(e, "pointerenter"); painter.onmove(e); };
            canvas.onpointerover = (e) => { this.onEvent(e, "pointerover"); painter.onmove(e); };
        } else {
            canvas.onpointerdown = (e) => this.onEvent(e, "pointerdown");
            canvas.onpointerup = (e) => this.onEvent(e, "pointerup");
            canvas.onpointercancel = (e) => this.onEvent(e, "pointercancel");
            canvas.onpointermove = (e) => this.onEvent(e, "pointermove");
            canvas.onpointerout = (e) => this.onEvent(e, "pointerout");
            canvas.onpointerleave = (e) => this.onEvent(e, "pointerleave");
            canvas.onpointerenter = (e) => this.onEvent(e, "pointerenter");
            canvas.onpointerover = (e) => this.onEvent(e, "pointerover");
        }

        // This is a workaround for the following Safari/WebKit bug:
        // https://bugs.webkit.org/show_bug.cgi?id=217430
        // I have no idea why this works but it does.
        video.ontouchmove = (e) => e.preventDefault();
        canvas.ontouchmove = (e) => e.preventDefault();

        for (let elem of [video, canvas]) {
            elem.onwheel = (e) => {
                this.webSocket.send(JSON.stringify({ "WheelEvent": new WEvent(e) }));
            }
        }
    }

    onEvent(event: PointerEvent, event_type: string) {
        if (settings.checks.get("enable_debug_overlay").checked) {
            let props = [
                "altKey",
                "altitudeAngle",
                "azimuthAngle",
                "button",
                "buttons",
                "clientX",
                "clientY",
                "ctrlKey",
                "height",
                "isPrimary",
                "metaKey",
                "movementX",
                "movementY",
                "offsetX",
                "offsetY",
                "pageX",
                "pageY",
                "pointerId",
                "pointerType",
                "pressure",
                "screenX",
                "screenY",
                "shiftKey",
                "tangentialPressure",
                "tiltX",
                "tiltY",
                "timeStamp",
                "twist",
                "type",
                "width",
                "x",
                "y",
            ];
            if (!last_pointer_data) {
                last_pointer_data = {};
                for (let prop of props) {
                    let span_id = `prop_${prop}_span`;
                    let span = document.getElementById(span_id);
                    span = document.createElement("span");
                    span.id = span_id;
                    debug_overlay.appendChild(span);
                    debug_overlay.appendChild(document.createElement("br"));
                }
            }
            for (let prop of props) {
                let span_id = `prop_${prop}_span`;
                let span = document.getElementById(span_id);
                let v = event[prop];
                span.textContent = `${prop}: ${v}`;
                if (last_pointer_data[prop] == v) {
                    span.classList.remove("updated");
                } else {
                    span.classList.add("updated");
                    last_pointer_data[prop] = v;
                }
            }
        }
        if (this.pointerTypes.includes(event.pointerType)) {
            let rect = input_rect(event.target as HTMLElement);
            const events = event_type === "pointermove" && typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
            for (let event of events) {
                this.webSocket.send(
                    JSON.stringify(
                        {
                            "PointerEvent": new PEvent(
                                event_type,
                                event,
                                rect
                            )
                        }
                    )
                );
            }
            if (settings.visible) {
                settings.toggle();
            }
        }
    }
}

class KEvent {
    event_type: string;
    code: string;
    key: string;
    location: number;
    alt: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;

    constructor(event_type: string, event: KeyboardEvent) {
        this.event_type = event_type;
        this.code = event.code;
        this.key = event.key;
        this.location = event.location;
        this.alt = event.altKey;
        this.ctrl = event.ctrlKey;
        this.shift = event.shiftKey;
        this.meta = event.metaKey;
    }
}

class KeyboardHandler {
    webSocket: WebSocket;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;

        let d = document;
        let s = document.getElementById("settings")

        // Consume all KeyboardEvents, except the settings menu is open.
        // this avoids making the main/video/canvas element focusable by using
        // a tabindex which interferes with PointerEvent than can be considered
        // hovering.

        function settings_hidden() {
            return s.classList.contains("hide") || s.classList.contains("vanish");
        }

        d.onkeydown = (e) => {
            if (!settings_hidden())
                return true;
            if (e.repeat)
                return this.onEvent(e, "repeat");
            return this.onEvent(e, "down");
        };
        d.onkeyup = (e) => {
            if (!settings_hidden())
                return true;
            return this.onEvent(e, "up");
        };
        d.onkeypress = (e) => {
            if (!settings_hidden())
                return true;
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
    }

    onEvent(event: KeyboardEvent, event_type: string) {
        this.webSocket.send(JSON.stringify({ "KeyboardEvent": new KEvent(event_type, event) }));
        event.preventDefault();
        event.stopPropagation();
        return false;
    }
}

function frame_rate_stats() {
    let t = performance.now();
    let fps = Math.round(frame_count / (t - last_fps_calc) * 10000) / 10;
    fps_out.value = fps.toString();
    frame_count = 0;
    last_fps_calc = t;
    setTimeout(() => frame_rate_stats(), 1500);
}

function handle_messages(
    webSocket: WebSocket,
    video: HTMLVideoElement,
    onConfigOk: Function,
    onConfigError: Function,
    onCapturableList: Function,
) {
    let mediaSource: MediaSource = null;
    let sourceBuffer: SourceBuffer = null;
    let queue = [];
    const MAX_BUFFER_LENGTH = 20;  // In seconds
    function upd_buf() {
        if (sourceBuffer == null)
            return;
        if (!sourceBuffer.updating && queue.length > 0 && mediaSource.readyState == "open") {
            let buffer_length = 0;
            if (sourceBuffer.buffered.length) {
                // Assume only one time range...
                buffer_length = sourceBuffer.buffered.end(0) - sourceBuffer.buffered.start(0);
            }
            if (buffer_length > MAX_BUFFER_LENGTH) {
                sourceBuffer.remove(0, sourceBuffer.buffered.end(0) - MAX_BUFFER_LENGTH / 2);
                // This will trigger updateend when finished
            } else {
                try {
                    sourceBuffer.appendBuffer(queue.shift());
                } catch (err) {
                    log(LogLevel.DEBUG, "Error appending to sourceBuffer:" + err);
                    // Drop everything, and try to pick up the stream again
                    if (sourceBuffer.updating)
                        sourceBuffer.abort();
                    sourceBuffer.remove(0, Infinity);
                }
            }
        }
    }
    webSocket.onmessage = (event: MessageEvent) => {
        if (typeof event.data == "string") {
            let msg = JSON.parse(event.data);
            if (typeof msg == "string") {
                if (msg == "NewVideo") {
                    let MS = window.ManagedMediaSource ? window.ManagedMediaSource : window.MediaSource;
                    mediaSource = new MS();
                    sourceBuffer = null;
                    video.src = URL.createObjectURL(mediaSource);
                    mediaSource.addEventListener("sourceopen", (_) => {
                        let mimeType = 'video/mp4; codecs="avc1.4D403D"';
                        if (!MS.isTypeSupported(mimeType))
                            mimeType = "video/mp4";
                        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
                        sourceBuffer.addEventListener("updateend", upd_buf);
                        // try to recover from errors by restarting the video
                        if (sourceBuffer.onerror)
                            sourceBuffer.onerror = () => settings.send_server_config();
                    })
                } else if (msg == "ConfigOk") {
                    onConfigOk();
                }
            } else if (typeof msg == "object") {
                if ("CapturableList" in msg)
                    onCapturableList(msg["CapturableList"]);
                else if ("Error" in msg)
                    alert(msg["Error"]);
                else if ("ConfigError" in msg) {
                    onConfigError(msg["ConfigError"]);
                } else if ("CustomInputAreas" in msg) {
                    settings.custom_input_areas = msg["CustomInputAreas"];
                    settings.checks.get("enable_custom_input_areas").checked = true;
                    settings.save_settings();
                }
            }

            return;
        }

        // not a string -> got a video frame
        queue.push(event.data);
        upd_buf();
        frame_count += 1;

        // only seek if there is data available, some browsers choke otherwise
        if (video.seekable.length > 0) {
            let seek_time = video.seekable.end(video.seekable.length - 1);
            if (video.readyState >= (settings.check_aggressive_seek.checked ? 3 : 4)
                // but make sure to catch up if the video is more than 3 seconds behind
                || seek_time - video.currentTime > 3) {
                if (isFinite(seek_time))
                    video.currentTime = seek_time;
                else
                    log(LogLevel.WARN, "Failed to seek to end of video.")
            }

        }
    }
}

function check_apis() {
    let apis = [
        {
            attrs: ["MediaSource", "ManagedMediaSource"],
            msg: "This browser doesn't support MSE/MMS required to playback video stream, try upgrading!"
        },
        {
            attrs: ["PointerEvent"],
            msg: "This browser doesn't support PointerEvents, input will not work, try upgrading!"
        },
    ];

    outer:
    for (let d of apis) {
        for (let attr of d.attrs) {
            if (attr in window) {
                continue outer;
            }
        }
        log(LogLevel.ERROR, d.msg);
    }
}

function init() {
    check_apis();

    let protocol = document.location.protocol == "https:" ? "wss://" : "ws://";
    let webSocket = new WebSocket(
        protocol + window.location.hostname + ":" +
        window.location.port + "/ws" + window.location.search
    );
    webSocket.binaryType = "arraybuffer";

    debug_overlay = document.getElementById("debug_overlay");
    settings = new Settings(webSocket);
    stretch_video();

    let video = document.getElementById("video") as HTMLVideoElement;
    let canvas = document.getElementById("canvas") as HTMLCanvasElement;

    video.oncontextmenu = function(event) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    };
    canvas.oncontextmenu = function(event) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    };

    let toggle_fullscreen_btn = document.getElementById("fullscreen") as HTMLButtonElement;

    if (document.exitFullscreen) {
        toggle_fullscreen_btn.onclick = () => {
            if (!document.fullscreenElement)
                document.body.requestFullscreen({ navigationUI: "hide" });
            else
                document.exitFullscreen();
        }
    } else {
        // if document.exitFullscreen is not present we are probably running on iOS/iPadOS.
        // As input is broken in fullscreen mode on these, do not offer fullscreen in the first
        // place.
        toggle_fullscreen_btn.parentElement.removeChild(toggle_fullscreen_btn);
    }

    let handle_disconnect = (msg: string) => {
        document.body.onclick = video.onclick = (e) => {
            e.stopPropagation();
            if (window.confirm(msg + " Reload page?"))
                location.reload();
        }
    }
    webSocket.onerror = () => handle_disconnect("Lost connection.");
    webSocket.onclose = () => handle_disconnect("Connection closed.");
    window.onresize = () => {
        stretch_video();
        settings.mappingBox.updateDOM();
        settings.update_scale_video_output();
        settings.send_server_config();
    }
    video.controls = false;
    video.disableRemotePlayback = true;
    video.onloadeddata = () => stretch_video();
    let is_connected = false;
    handle_messages(webSocket, video, () => {
        if (!is_connected) {
            new KeyboardHandler(webSocket);
            new PointerHandler(webSocket);
            is_connected = true;
        }
    },
        (err) => alert(err),
        (window_names) => settings.onCapturableList(window_names)
    );
    window.onunload = () => { webSocket.close(); }
    webSocket.onopen = function(event) {
        webSocket.send('"GetCapturableList"');
        if (!settings.video_enabled())
            webSocket.send('"PauseVideo"');

        settings.send_server_config();

        document.onvisibilitychange = () => {
            if (document.hidden) {
                webSocket.send('"PauseVideo"');
            } else if (settings.video_enabled()) {
                webSocket.send('"ResumeVideo"');
            }
        };
    }
    frame_rate_stats();
}

function stretch_video() {
    let video = document.getElementById("video") as HTMLVideoElement;
    video.style.objectFit = settings.stretched_video() ? "fill" : "contain";
}
