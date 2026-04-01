# OPCloud Toolkit

Chrome Web Store:

- [OPCloud Toolkit](https://chromewebstore.google.com/detail/opcloud-toolkit/gmdkdhgmibgfjablmnjfacficdcflbaa)

Note:

- the Web Store listing may lag behind the latest repo release because store updates need review
- for the current source version, check [`manifest.json`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/chrome_extension/manifest.json)

Tools for exporting, importing, and generating OPCloud Sandbox diagrams.

This repo has two main parts:

- a Chrome extension that works against the live [OPCloud Sandbox](https://opcloud-sandbox.web.app/)
- a Python builder/conversion package for authoring and regenerating diagram JSON

## What This Repo Does

Most users do not need to read or write any code.

The normal workflow is:

1. build your OPD in OPCloud the same way you already do
2. use the extension to export the full OPD tree to JSON
3. later, import that JSON back into OPCloud

The Python tools are optional and are mainly for programmatic generation,
conversion, or debugging.

The extension talks to the real OPCloud runtime in the page instead of trying to
redraw diagrams outside OPCloud. That lets OPCloud remain the actual editor and
renderer while this toolkit handles:

- export and import of OPD trees
- object, process, and state reconstruction
- hierarchy reconstruction for unfold and in-zoom
- semantic link creation and deletion
- geometry replay for nodes, states, links, and groups

The Python side gives you a reusable builder and conversion flow for working
with OPCloud data outside the browser.

## Repo Layout

- [`chrome_extension`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/chrome_extension): unpacked Chrome extension, including the main toolkit runtime in [`toolkit.js`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/chrome_extension/toolkit.js)
- [`python_opd_builder`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder): Python builder and JSON conversion utilities
- [`scripts`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts): example Python builder scripts
- [`example_exports`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/example_exports): generated example outputs

## Python Builder

The Python workflow centers on [`python_opd_builder`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder):

- [`authoring.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/authoring.py): Python API for building OPDs
- [`export_to_authoring.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/export_to_authoring.py): convert OPCloud export/importable JSON into authoring JSON
- [`build_importable.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/build_importable.py): compile authoring JSON back into OPCloud-importable JSON
- [`AUTHORING_FORMAT.md`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/AUTHORING_FORMAT.md): authoring format reference

Typical flow:

1. Build diagrams in Python with `AuthoringProject()`, or convert an existing OPCloud export into authoring JSON.
2. Save authoring JSON as an intermediate, human-editable representation.
3. Compile authoring JSON into OPCloud-importable JSON.

Example:

```python
from python_opd_builder.authoring import AuthoringProject, LinkType, opmObj, opmProc

project = AuthoringProject()
sd = project.get_sd()

customer = opmObj("Customer", key="customer")
customer.updateState("Interested", "Verified")
sd.addObject(customer)

checkout = opmProc("Checkout", key="checkout")
sd.addProcess(checkout)
sd.addLink(LinkType.CONSUMPTION, customer.ref("verified"), checkout)
```

Examples in this repo:

- [`build_example_opd.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_example_opd.py)
- [`build_complex_opd.py`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_complex_opd.py)

## Chrome Extension

The extension currently runs on:

- `https://opcloud-sandbox.web.app/*`

Main popup actions:

- initialize toolkit on the current OPCloud tab
- export the current full OPD tree to JSON
- copy exported JSON to clipboard
- import from a JSON file
- import from pasted JSON

## Limitations

- some advanced OPCloud behaviors are still reverse-engineered and fragile
- link geometry and state positioning can still drift after reconstruction
- `OvertimeException` and `SelfInvokation` links are not well tested
- max-duration behavior is not handled yet
- in-diagram in-zoom UI actions are not exposed as popup features
- font differences are not modeled explicitly

## Development

To load the extension locally:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select [`chrome_extension`](C:/Users/anguangyan/CodexProjects/opcloud_toolkit/chrome_extension)

If OPCloud behavior changes upstream, the first things to try are:

1. reload the extension
2. refresh the OPCloud page
3. initialize the toolkit again
