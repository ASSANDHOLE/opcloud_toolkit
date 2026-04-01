# OPCloud Toolkit Extension

This folder is the unpacked Chrome extension used for local development.

## Main Files

- `manifest.json`: extension manifest
- `content-script.js`: injects the toolkit and page bridge
- `page-bridge.js`: page-world bridge between popup and toolkit
- `popup.html`, `popup.css`, `popup.js`: popup UI
- `toolkit.js`: main OPCloud runtime toolkit used by the extension

## Development Install

1. Open Chrome and go to `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select this `chrome_extension` folder
5. Open OPCloud Sandbox
6. Click the extension icon and use `Initialize Toolkit`

## Notes

- Export and import stay disabled until the page is initialized.
- This build is restricted to `https://opcloud-sandbox.web.app/*`.
- Chrome Web Store: [OPCloud Toolkit](https://chromewebstore.google.com/detail/opcloud-toolkit/gmdkdhgmibgfjablmnjfacficdcflbaa)
- The Web Store listing may not be the latest repo version because extension updates need review before publication.
- For the current source version, check [`manifest.json`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/chrome_extension/manifest.json).
