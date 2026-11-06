**English | [简体中文](README.zh-CN.md)**

<p align="center">
  <img src="./assets/readme/hero-en-v2.svg" width="100%" alt="NetSnap: Record. Select. Export.">
</p>

Record browser network traffic and export HAR files, cookies, tokens, or a request summary without opening DevTools.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or Edge and enable Developer mode.
3. Choose **Load unpacked** and select the `NetSnap` directory.
4. Pin the extension from the browser toolbar.

## Record and export

1. Open and sign in to the site you want to record.
2. Open NetSnap and start recording. Keep the browser's debugging notice open.
3. Perform the action you want to capture, then stop recording.
4. Choose HAR, Cookie and/or Token, select all or checked requests, and download.

HAR export follows version 1.2. Cookies are extracted from request and response headers, and tokens from authorization headers. A request summary can also be downloaded as Markdown. Processing is local and the extension has no build step or npm dependencies.

## How it works

The extension attaches `chrome.debugger` to the current tab, records network events, then builds the selected exports. It requests debugger, downloads, active-tab and storage permissions. See the [user manual](docs/使用手册.md) for permissions, limitations and troubleshooting.

## License

[MIT](LICENSE)
