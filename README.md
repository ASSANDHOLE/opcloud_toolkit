# OPCloud Toolkit

Toolkit and Chrome extension for exporting and importing diagrams in [OPCloud Sandbox](https://opcloud-sandbox.web.app/).

## What It Is

OPCloud Sandbox is a free web-based OPD editor, but it does not provide a native export/import workflow for the use case this project needs.

This project works around that by interacting with the real OPCloud runtime in the page instead of redrawing diagrams externally. The goal is to let OPCloud stay the actual editor and renderer while this toolkit handles:

- bootstrap/runtime capture
- object and process creation
- state creation
- rename operations
- essence and affiliation changes
- semantic link creation
- semantic deletion
- export/import of OPD structure
- hierarchy reconstruction, including unfold and in-zoom cases

## Repository Layout

- [`test/toolkit.js`](test/toolkit.js): current toolkit source
- [`chrome_extension`](chrome_extension): Chrome extension wrapper for the toolkit

## Chrome Extension

The extension is currently scoped to:

- `https://opcloud-sandbox.web.app/*`

Main popup features:

- initialize toolkit for the current OPCloud tab
- export full tree JSON to file
- copy full tree JSON to clipboard
- import from JSON file
- import from pasted JSON

## Known Limitations

- `OvertimeException` links are not tested
- max-duration behavior is not currently handled
- fonts are not explicitly considered for fidelity
- in-diagram in-zoom UI behavior is not exposed as a popup feature
- some advanced OPCloud features are still unsupported
- link geometry and state positioning can still be imperfect after reconstruction

## Stability Notes

This project depends on OPCloud Sandbox internals and reverse-engineered runtime behavior. Upstream changes in OPCloud may break:

- bootstrap
- import/export
- runtime lookup
- geometry replay

If something suddenly stops working, first try:

1. reloading the extension
2. refreshing the OPCloud page
3. re-bootstrapping the toolkit

## Development

To load the extension locally:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the [`chrome_extension`](chrome_extension) folder

## Publishing Notes

Before uploading to the Chrome Web Store:

- zip the contents of `chrome_extension` for upload
- make sure the store listing clearly says this only works on OPCloud Sandbox
- review permissions and keep them narrow
- prepare screenshots of the popup on the OPCloud Sandbox page
