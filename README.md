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

- [`test/toolkit.js`](tmp/test/toolkit.js): current toolkit source
- [`chrome_extension`](chrome_extension): Chrome extension wrapper for the toolkit
- [`python_opd_builder`](python_opd_builder): reusable Python OPD builder and conversion package
- [`scripts`](scripts): one simple and one complex builder example

## Python OPD Builder

The reusable Python code lives under [`python_opd_builder`](python_opd_builder):

- [`python_opd_builder/authoring.py`](python_opd_builder/authoring.py): author OPDs from Python
- [`python_opd_builder/export_to_authoring.py`](python_opd_builder/export_to_authoring.py): convert OPCloud exports into the authoring format
- [`python_opd_builder/build_importable.py`](python_opd_builder/build_importable.py): compile authoring JSON into OPCloud-importable JSON
- [`python_opd_builder/AUTHORING_FORMAT.md`](python_opd_builder/AUTHORING_FORMAT.md): authoring JSON format reference

How it works:

1. Create an `AuthoringProject()`
2. Get the default root OPD with `project.get_sd()`
3. Add objects, processes, states, links, unfolds, and in-zooms with the builder API
4. Save authoring JSON, or compile it into OPCloud-importable JSON

Typical usage:

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

Example scripts:

- [`scripts/build_example_opd.py`](scripts/build_example_opd.py): simple example
- [`scripts/build_complex_opd.py`](scripts/build_complex_opd.py): complex placeholder with multiple actions

You can see the generated files in [`example_exports`](example_exports).

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

- `OvertimeException` and `SelfInvokation` links are not tested
- max-duration behavior is not currently handled
- Inheritance of `Exhibition` is not properly reconstructed (e.g. `Obj1` exhibits `Obj2`, `Obj2` exhibits `Obj3`, unfold `Obj3`, Remove `Obj1` from the sub-opd, `Obj2` will change name from `Obj2` to `Obj2 of Obj1`, but we did not handle that)
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

The unpacked extension now includes an icon, so Chrome should show a proper logo
in the extensions page and toolbar when loaded from source.

## Publishing Notes

Before uploading to the Chrome Web Store:

- zip the contents of `chrome_extension` for upload
- make sure the store listing clearly says this only works on OPCloud Sandbox
- review permissions and keep them narrow
- prepare screenshots of the popup on the OPCloud Sandbox page
