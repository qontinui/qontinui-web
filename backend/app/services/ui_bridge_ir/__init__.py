"""UI Bridge IR (Intermediate Representation) services.

Python port of the TypeScript IR projection from
`qontinui-schemas/ts/src/ui-bridge-ir/projection.ts`. Used by the
qontinui-web Spec API to project authoring-time IR documents into the
legacy `*.spec.uibridge.json` shape that downstream tooling consumes.

The projection is byte-stable: object keys are sorted lexicographically
at the final step, arrays preserve input order, no timestamps or random
IDs are introduced. This must match the runner's Rust port at
`qontinui-runner/src-tauri/src/spec_api/projection.rs` exactly so the
two paths can be byte-diffed.
"""

from app.services.ui_bridge_ir.projection import (
    project_ir_to_bundled_page,
    project_to_pretty_json,
)

__all__ = ["project_ir_to_bundled_page", "project_to_pretty_json"]
