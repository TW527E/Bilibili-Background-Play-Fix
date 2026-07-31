// ==UserScript==
// @name         Bilibili Safari 背景播放修復
// @name:zh-TW   Bilibili Safari 背景播放修復
// @name:en      Bilibili Safari Background Playback Fix
// @namespace    https://github.com/TW527E/Bilibili-Background-Play-Fix
// @version      1.0.1
// @description  修復 Safari 切換分頁後 Bilibili 容易暫停、卡住及停止預載後續影片的問題。
// @description:zh-TW 修復 Safari 切換分頁後 Bilibili 容易暫停、卡住及停止預載後續影片的問題。
// @description:en Keeps Bilibili playing and buffering after switching Safari tabs, and recovers unexpected pauses and stalls.
// @author       TW527E
// @homepageURL  https://greasyfork.org/zh-TW/scripts/589347-bilibili-safari-%E8%83%8C%E6%99%AF%E6%92%AD%E6%94%BE%E4%BF%AE%E5%BE%A9
// @supportURL   https://greasyfork.org/zh-TW/scripts/589347-bilibili-safari-%E8%83%8C%E6%99%AF%E6%92%AD%E6%94%BE%E4%BF%AE%E5%BE%A9/feedback
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @match        https://www.bilibili.com/medialist/play/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/festival/*
// @match        https://m.bilibili.com/video/*
// @match        https://m.bilibili.com/bangumi/play/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    if (window.__bilibiliSafariBackgroundPlayFix) return;

    const CONFIG = Object.freeze({
        // 讓 Bilibili 認為頁面一直可見，避免它自行停止載入及播放。
        fakePageVisibility: true,

        // Safari 背景計時器會降頻；Worker 只負責低頻檢查，不會高耗電輪詢。
        watchdogIntervalMs: 1500,

        // 播放時間停止前進多久後才做一次極小幅度的解卡處理。
        stalledThresholdMs: 7000,
        kickCooldownMs: 10000,

        // 可在 Web Inspector 執行：
        // __bilibiliSafariBackgroundPlayFix.setDebug(true)
        debug: false,
    });

    const TAG = '[Bilibili Background Fix]';
    let debugEnabled = CONFIG.debug;
    let actuallyHidden = false;
    let lastNativeVisibilityChange = Date.now();
    let watchdogWorker = null;
    let fallbackTimer = 0;
    let observer = null;

    const mediaStates = new WeakMap();
    const trackedMedia = new Set();

    const log = (...args) => {
        if (debugEnabled) console.debug(TAG, ...args);
    };

    const findDescriptor = (object, property) => {
        for (let current = object; current; current = Object.getPrototypeOf(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, property);
            if (descriptor) return descriptor;
        }
        return null;
    };

    // 必須先保留原生 getter；覆寫後仍靠它判斷 Safari 實際是否在背景。
    const nativeHiddenDescriptor = findDescriptor(document, 'hidden');
    const nativeVisibilityDescriptor = findDescriptor(document, 'visibilityState');
    const nativeWebkitHiddenDescriptor = findDescriptor(document, 'webkitHidden');
    const nativeWebkitVisibilityDescriptor = findDescriptor(document, 'webkitVisibilityState');

    const readNativeHidden = () => {
        try {
            if (nativeHiddenDescriptor?.get) {
                return Boolean(nativeHiddenDescriptor.get.call(document));
            }
            if (nativeVisibilityDescriptor?.get) {
                return nativeVisibilityDescriptor.get.call(document) !== 'visible';
            }
        } catch (error) {
            log('無法讀取原生頁面可見狀態', error);
        }
        return !document.hasFocus();
    };

    actuallyHidden = readNativeHidden();

    const defineGetter = (property, value) => {
        try {
            Object.defineProperty(document, property, {
                configurable: true,
                enumerable: true,
                get: () => value,
            });
            return true;
        } catch (error) {
            log(`無法覆寫 document.${property}`, error);
            return false;
        }
    };

    const installVisibilityShim = () => {
        if (!CONFIG.fakePageVisibility) return;

        defineGetter('hidden', false);
        defineGetter('visibilityState', 'visible');

        if (nativeWebkitHiddenDescriptor || 'webkitHidden' in document) {
            defineGetter('webkitHidden', false);
        }
        if (nativeWebkitVisibilityDescriptor || 'webkitVisibilityState' in document) {
            defineGetter('webkitVisibilityState', 'visible');
        }
    };

    const getState = (media) => {
        let state = mediaStates.get(media);
        if (!state) {
            state = {
                wanted: !media.paused && !media.ended,
                lastCurrentTime: Number(media.currentTime) || 0,
                lastProgressAt: Date.now(),
                lastKickAt: 0,
                rescuePending: false,
            };
            mediaStates.set(media, state);
        }
        return state;
    };

    const bufferedEndAfter = (media, time) => {
        try {
            for (let index = 0; index < media.buffered.length; index += 1) {
                const start = media.buffered.start(index);
                const end = media.buffered.end(index);
                if (time >= start && time <= end) return end;
            }
        } catch (error) {
            log('讀取 buffered 區間失敗', error);
        }
        return null;
    };

    const safePlay = (media, reason) => {
        if (!media.isConnected || media.ended || media.error) return;

        const state = getState(media);
        if (!state.wanted) return;

        try {
            const promise = media.play();
            if (promise?.catch) {
                promise.catch((error) => log(`play() 未成功（${reason}）`, error));
            }
            log('嘗試恢復播放：', reason);
        } catch (error) {
            log(`play() 發生例外（${reason}）`, error);
        }
    };

    const kickStalledMedia = (media, state, now) => {
        if (now - state.lastKickAt < CONFIG.kickCooldownMs) return;
        state.lastKickAt = now;

        // 先喚醒 Bilibili 綁在媒體事件上的分段下載／緩衝排程器。
        media.dispatchEvent(new Event('timeupdate'));
        media.dispatchEvent(new Event('progress'));
        safePlay(media, '背景播放停滯');

        // 只有下一小段已經在 buffer 裡才做 1ms seek；不在 buffer 時不亂跳進度。
        const currentTime = Number(media.currentTime) || 0;
        const bufferedEnd = bufferedEndAfter(media, currentTime);
        if (!media.seeking && bufferedEnd !== null && bufferedEnd - currentTime > 0.25) {
            const duration = Number.isFinite(media.duration) ? media.duration : Infinity;
            media.currentTime = Math.min(currentTime + 0.001, bufferedEnd - 0.01, duration - 0.01);
            log('已用 1ms seek 喚醒 Safari 媒體管線');
        }
    };

    const applyMediaHints = (media) => {
        // Bilibili 的 SPA 播放器可能在我們接管後再次改寫 preload，因此 watchdog 也會維持它。
        if (media.preload !== 'auto') media.preload = 'auto';
        if (media.getAttribute('preload') !== 'auto') media.setAttribute('preload', 'auto');
        if (!media.hasAttribute('playsinline')) media.setAttribute('playsinline', '');
        if (!media.hasAttribute('webkit-playsinline')) media.setAttribute('webkit-playsinline', '');
    };

    const inspectMedia = (media, now = Date.now()) => {
        if (!media.isConnected) {
            trackedMedia.delete(media);
            return;
        }

        applyMediaHints(media);

        const state = getState(media);
        const currentTime = Number(media.currentTime) || 0;

        if (Math.abs(currentTime - state.lastCurrentTime) > 0.01) {
            state.lastCurrentTime = currentTime;
            state.lastProgressAt = now;
        }

        if (!actuallyHidden || !state.wanted || media.ended || media.error) return;

        // Bilibili 或 Safari 在切到背景後將元素 pause 時，恢復使用者原本要求的播放。
        if (media.paused) {
            safePlay(media, '背景中被暫停');
            return;
        }

        if (now - state.lastProgressAt >= CONFIG.stalledThresholdMs) {
            kickStalledMedia(media, state, now);
        }
    };

    const queueRescue = (media, reason) => {
        const state = getState(media);
        if (!actuallyHidden || !state.wanted || state.rescuePending) return;

        state.rescuePending = true;
        queueMicrotask(() => {
            state.rescuePending = false;
            if (actuallyHidden && state.wanted && !media.ended) {
                safePlay(media, reason);
            }
        });
    };

    const trackMedia = (media) => {
        if (!(media instanceof HTMLMediaElement) || trackedMedia.has(media)) return;

        trackedMedia.add(media);
        const state = getState(media);

        // preload 是提示而不是保證，但能避免 Bilibili 替換元素後退回 metadata/none。
        applyMediaHints(media);

        media.addEventListener('play', () => {
            state.wanted = true;
            state.lastProgressAt = Date.now();
            log('記錄播放意圖');
        }, true);

        media.addEventListener('playing', () => {
            state.wanted = true;
            state.lastCurrentTime = Number(media.currentTime) || 0;
            state.lastProgressAt = Date.now();
        }, true);

        media.addEventListener('timeupdate', () => {
            const currentTime = Number(media.currentTime) || 0;
            if (Math.abs(currentTime - state.lastCurrentTime) > 0.01) {
                state.lastCurrentTime = currentTime;
                state.lastProgressAt = Date.now();
            }
        }, true);

        media.addEventListener('pause', () => {
            if (media.ended) {
                state.wanted = false;
                return;
            }

            // 前景中的 pause 視為使用者操作；背景中的 pause 視為網站／Safari 暫停。
            if (!actuallyHidden) {
                state.wanted = false;
            } else {
                queueRescue(media, '收到背景 pause 事件');
            }
        }, true);

        media.addEventListener('ended', () => {
            state.wanted = false;
            state.lastProgressAt = Date.now();
        }, true);

        for (const eventName of ['waiting', 'stalled', 'suspend']) {
            media.addEventListener(eventName, () => {
                if (actuallyHidden && state.wanted) {
                    queueRescue(media, `收到 ${eventName} 事件`);
                }
            }, true);
        }

        log('已接管媒體元素', media);
    };

    const scanMedia = (root = document) => {
        if (root instanceof HTMLMediaElement) trackMedia(root);
        if (typeof root.querySelectorAll === 'function') {
            root.querySelectorAll('video, audio').forEach(trackMedia);
        }
    };

    const onNativeVisibilityChange = (event) => {
        actuallyHidden = readNativeHidden();
        lastNativeVisibilityChange = Date.now();

        for (const media of trackedMedia) {
            const state = getState(media);
            if (actuallyHidden) {
                // 在 Bilibili 的 visibilitychange handler 有機會 pause 前先記住播放狀態。
                state.wanted = state.wanted || (!media.paused && !media.ended);
                state.lastCurrentTime = Number(media.currentTime) || 0;
                state.lastProgressAt = Date.now();
            }
        }

        log('Safari 原生可見狀態：', actuallyHidden ? 'hidden' : 'visible');

        if (CONFIG.fakePageVisibility) {
            // 此 listener 在 document-start 註冊，阻止網站收到真正的 hidden 狀態。
            event.stopImmediatePropagation();
        }
    };

    const watchdogTick = () => {
        const now = Date.now();
        scanMedia();
        for (const media of [...trackedMedia]) inspectMedia(media, now);
    };

    const startWatchdog = () => {
        try {
            const source = `setInterval(() => postMessage(Date.now()), ${CONFIG.watchdogIntervalMs});`;
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            watchdogWorker = new Worker(url);
            URL.revokeObjectURL(url);
            watchdogWorker.onmessage = watchdogTick;
            watchdogWorker.onerror = (error) => {
                log('Worker watchdog 失敗，改用一般計時器', error);
                watchdogWorker?.terminate();
                watchdogWorker = null;
                if (!fallbackTimer) fallbackTimer = window.setInterval(watchdogTick, CONFIG.watchdogIntervalMs);
            };
        } catch (error) {
            log('無法建立 Worker watchdog，改用一般計時器', error);
            fallbackTimer = window.setInterval(watchdogTick, CONFIG.watchdogIntervalMs);
        }
    };

    const startObserver = () => {
        const begin = () => {
            scanMedia();
            if (!document.documentElement || observer) return;

            observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) scanMedia(node);
                    }
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        };

        if (document.documentElement) begin();
        else document.addEventListener('DOMContentLoaded', begin, { once: true, capture: true });
    };

    // 先攔截真正的 visibilitychange，再把 getter 改成永遠 visible。
    document.addEventListener('visibilitychange', onNativeVisibilityChange, true);
    document.addEventListener('webkitvisibilitychange', onNativeVisibilityChange, true);
    installVisibilityShim();
    startObserver();
    startWatchdog();

    const api = Object.freeze({
        version: '1.0.1',
        status: () => ({
            version: '1.0.1',
            actuallyHidden,
            reportedHidden: document.hidden,
            reportedVisibilityState: document.visibilityState,
            trackedMedia: trackedMedia.size,
            playingWanted: [...trackedMedia].filter((media) => getState(media).wanted).length,
            watchdog: watchdogWorker ? 'worker' : 'timer',
            debug: debugEnabled,
            lastNativeVisibilityChange,
        }),
        rescue: () => {
            for (const media of trackedMedia) {
                const state = getState(media);
                if (!media.ended) state.wanted = state.wanted || !media.paused;
                inspectMedia(media);
            }
        },
        setDebug: (enabled) => {
            debugEnabled = Boolean(enabled);
            return debugEnabled;
        },
    });

    Object.defineProperty(window, '__bilibiliSafariBackgroundPlayFix', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: api,
    });

    log('已啟動', api.status());
})();
