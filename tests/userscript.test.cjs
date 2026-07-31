const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const userscript = fs.readFileSync(
    path.join(__dirname, '..', 'bilibili-safari-background-play.user.js'),
    'utf8',
);

const createHarness = ({ initiallyHidden = false, initiallyPaused = false } = {}) => {
    let nativeHidden = initiallyHidden;

    class MockMediaElement extends EventTarget {
        constructor() {
            super();
            this.paused = initiallyPaused;
            this.ended = false;
            this.error = null;
            this.isConnected = true;
            this.currentTime = 12;
            this.duration = 100;
            this.seeking = false;
            this.readyState = 4;
            this.preload = 'none';
            this.attributes = new Map();
            this.playCalls = 0;
            this.buffered = {
                length: 1,
                start: () => 0,
                end: () => 30,
            };
        }

        setAttribute(name, value) {
            this.attributes.set(name, String(value));
            if (name === 'preload') this.preload = String(value);
        }

        getAttribute(name) {
            return this.attributes.has(name) ? this.attributes.get(name) : null;
        }

        hasAttribute(name) {
            return this.attributes.has(name);
        }

        play() {
            this.playCalls += 1;
            this.paused = false;
            return Promise.resolve();
        }
    }

    const media = new MockMediaElement();

    class MockDocument extends EventTarget {
        get hidden() {
            return nativeHidden;
        }

        get visibilityState() {
            return nativeHidden ? 'hidden' : 'visible';
        }

        hasFocus() {
            return !nativeHidden;
        }

        querySelectorAll(selector) {
            return selector === 'video, audio' ? [media] : [];
        }
    }

    const document = new MockDocument();
    document.documentElement = { querySelectorAll: () => [] };

    class MockMutationObserver {
        constructor(callback) {
            this.callback = callback;
        }

        observe() {}
    }

    class MockWorker {
        constructor() {
            this.onmessage = null;
            this.onerror = null;
        }

        terminate() {}
    }

    const window = {
        setInterval: () => 1,
        clearInterval: () => {},
    };
    window.window = window;

    const context = vm.createContext({
        Blob,
        console,
        document,
        Event,
        EventTarget,
        HTMLMediaElement: MockMediaElement,
        MutationObserver: MockMutationObserver,
        Node: { ELEMENT_NODE: 1 },
        Object,
        Promise,
        URL: {
            createObjectURL: () => 'blob:test',
            revokeObjectURL: () => {},
        },
        WeakMap,
        Worker: MockWorker,
        clearInterval: window.clearInterval,
        queueMicrotask,
        setInterval: window.setInterval,
        window,
    });

    vm.runInContext(userscript, context, { filename: 'bilibili-safari-background-play.user.js' });

    return {
        api: window.__bilibiliSafariBackgroundPlayFix,
        document,
        media,
        setHidden(value) {
            nativeHidden = value;
            document.dispatchEvent(new Event('visibilitychange'));
        },
    };
};

test('reports the page as visible and applies media preload hints', () => {
    const harness = createHarness();
    const status = harness.api.status();

    assert.equal(harness.document.hidden, false);
    assert.equal(harness.document.visibilityState, 'visible');
    assert.equal(status.trackedMedia, 1);
    assert.equal(harness.media.preload, 'auto');
    assert.equal(harness.media.getAttribute('preload'), 'auto');
    assert.equal(harness.media.hasAttribute('playsinline'), true);
});

test('restores an unexpected pause after the tab becomes hidden', async () => {
    const harness = createHarness({ initiallyPaused: false });

    harness.setHidden(true);
    harness.media.paused = true;
    harness.media.dispatchEvent(new Event('pause'));
    await new Promise((resolve) => queueMicrotask(resolve));

    assert.equal(harness.media.playCalls, 1);
    assert.equal(harness.media.paused, false);
    assert.equal(harness.api.status().actuallyHidden, true);
});

test('respects a pause made while the tab is in the foreground', async () => {
    const harness = createHarness({ initiallyPaused: false });

    harness.media.paused = true;
    harness.media.dispatchEvent(new Event('pause'));
    harness.setHidden(true);
    await new Promise((resolve) => queueMicrotask(resolve));

    assert.equal(harness.media.playCalls, 0);
    assert.equal(harness.api.status().playingWanted, 0);
});
