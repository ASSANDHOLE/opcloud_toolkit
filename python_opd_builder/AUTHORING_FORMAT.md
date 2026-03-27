# Python OPD Builder Authoring Format

This format is meant to be written by humans or AI, then converted into an
OPCloud-importable tree JSON.

## Goal

Instead of treating the OPCloud export as the source of truth, this format uses
stable semantic `key` values:

- no dependence on export IDs
- easy to write from Python code
- safe to re-save repeatedly
- references stay understandable

`python_opd_builder/export_to_authoring.py` converts old OPCloud exports into
this format and also canonicalizes existing authoring files.

`python_opd_builder/build_importable.py` converts this format back into an
importable OPCloud tree.

## Python Builder API

[`python_opd_builder/authoring.py`](/C:/Users/anguangyan/CodexProjects/opcloud_toolkit/python_opd_builder/authoring.py)
provides a class-based API for building this format directly from Python.

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

checkout_child = sd.inzoom("checkout", key="checkout-opd", name="Checkout")
checkout_child.addObject("Cart", key="cart")
checkout_child.addObject("Receipt", key="receipt")
checkout_child.addLink(LinkType.CONSUMPTION, "cart", "checkout-consume")
checkout_child.addLink(LinkType.RESULT, "checkout-yield", "receipt")

checkout_child.deleteEndpoint("cart")

project.save("tmp/demo.authoring.json")
```

Runnable examples:

- [`scripts/build_example_opd.py`](/C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_example_opd.py)
- [`scripts/build_complex_opd.py`](/C:/Users/anguangyan/CodexProjects/opcloud_toolkit/scripts/build_complex_opd.py)

## Builder Semantics

- `AuthoringProject()` creates a default root diagram named `SD`.
- Use `project.get_sd()` to retrieve that root diagram.
- `addObject(...)` and `addProcess(...)` fill in default positions and sizes when
  you omit them.
- Node `attributes` can also carry `statesArrange` for object state layout
  direction (`left`, `right`, `top`, `bottom`).
- `addLink(...)` accepts either node objects or string refs.
- State refs use `"node-key/state-key"` or `node.ref("state-key")`.
- `addLink(...)` with a structural `LinkType` and a list target creates a
  fundamental group.
- `unfold(..., inherit=True)` creates a child OPD for the focal node and copies
  first-hop relevant context into it. It does not auto-create extra subprocesses.
- `inzoom(..., inherit=True)` is process-oriented and auto-creates exactly two
  subprocesses under the focal process:
  - `<focal>-consume`
  - `<focal>-yield`
- `deleteEndpoint(...)` removes:
  - a node and its descendants
  - all states under deleted nodes
  - any link touching the deleted node/state
  - any structural group touching the deleted node/state

## Top-Level Shape

```json
{
  "format": "opcloud-authoring",
  "version": 1,
  "meta": {},
  "diagrams": []
}
```
