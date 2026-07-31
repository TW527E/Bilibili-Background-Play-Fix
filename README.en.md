[繁體中文](README.md) | [English](README.en.md)

# Bilibili Safari Background Playback Fix

A userscript made for Safari and Tampermonkey that improves Bilibili playback when its tab is in the background, preventing playback stalls and interrupted buffering after switching tabs.

## Quick Install

Direct installation will be available from Greasy Fork after its script page is created. You can also manually install [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js) from GitHub.

## Features

- Keeps playback running after switching to another Safari tab, but only if the user had already started it.
- Prevents Bilibili from pausing playback or segment loading in response to the Page Visibility API reporting a background tab.
- Keeps dynamically created or replaced media elements set to `preload="auto"`.
- Uses a low-frequency Worker watchdog to monitor background playback progress.
- Attempts recovery after unexpected `pause`, `waiting`, `stalled`, or `suspend` events in the background.
- If playback stops progressing for an extended period, performs a 1ms seek only within an already-buffered range to wake Safari's media pipeline.
- Respects user intent: it never starts an unplayed video and does not resume after a foreground manual pause.
- Collects, stores, and transmits no data, and makes no additional network requests.

## Supported Pages

- Standard Bilibili video pages
- Playlists and watch-later-style playback pages
- Bangumi playback pages
- Festival playback pages
- Bilibili mobile video and Bangumi pages

## Requirements

- macOS
- Safari
- [Tampermonkey for Safari](https://www.tampermonkey.net/?browser=safari)

## Installation

### Greasy Fork

1. Install and enable [Tampermonkey](https://www.tampermonkey.net/?browser=safari) in Safari.
2. Open the Greasy Fork script page.
3. Select the install option and confirm it in Tampermonkey.
4. Reload any open Bilibili playback page.

### Manual Installation

1. Open the Tampermonkey Dashboard and create a new userscript.
2. Delete the editor's default content.
3. Paste the complete contents of [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js) and save it.
4. Reload the Bilibili playback page.

> `@run-at document-start` is essential. It lets the script take control of the Page Visibility API before Bilibili registers its background-tab handlers.

## Usage

1. Start a video on Bilibili.
2. Allow the player to load some content.
3. Switch to another Safari tab; playback and subsequent buffering should continue.
4. Return to Bilibili and verify that playback progress remained continuous.

No configuration is required. To pause playback, return to the Bilibili tab and pause it there.

## Status and Debugging

Inspect the current state in the Safari Web Inspector Console:

```js
__bilibiliSafariBackgroundPlayFix.status()
```

Enable debug messages:

```js
__bilibiliSafariBackgroundPlayFix.setDebug(true)
```

Trigger one manual inspection:

```js
__bilibiliSafariBackgroundPlayFix.rescue()
```

## How It Works

The script first preserves Safari's native page-visibility getters, then reports `document.hidden === false` and `document.visibilityState === "visible"` to Bilibili. This prevents the site from disabling playback scheduling after a tab switch while allowing the script itself to retain Safari's real foreground/background state.

The watchdog intervenes only when the user previously requested playback and the page is actually in the background. It does not seek or restart the player while playback is progressing normally.

## Safari Limitations

`preload="auto"` is a browser hint, not a command. Safari may still limit background pages based on memory, network, and power conditions, and macOS may freeze or discard an entire tab under extreme resource pressure.

## Files

- [`bilibili-safari-background-play.user.js`](bilibili-safari-background-play.user.js) — Tampermonkey userscript
- [`README.md`](README.md) — Traditional Chinese documentation
- [`README.en.md`](README.en.md) — English documentation
- [`tests/userscript.test.cjs`](tests/userscript.test.cjs) — Node.js tests

## Development Checks

```bash
npm run check
npm test
```

## License

This project is licensed under the [MIT License](LICENSE).
