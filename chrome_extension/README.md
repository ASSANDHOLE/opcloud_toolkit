# OPCloud Toolkit Extension

Load this folder as an unpacked Chrome extension during development.

## Files

- `manifest.json`: extension manifest
- `content-script.js`: injects the toolkit and page bridge
- `page-bridge.js`: page-world bridge between popup and toolkit
- `popup.html`, `popup.css`, `popup.js`: popup UI
- `toolkit.js`: copied from the current toolkit source

## Dev install

1. Open Chrome and go to `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select this `chrome_extension` folder
5. Open the target OPCloud page
6. Click the extension icon and use `Initialize Toolkit`

## Notes

- Export/import buttons stay disabled until the current tab is bootstrapped.
- This build is restricted to `https://opcloud-sandbox.web.app/*`.
