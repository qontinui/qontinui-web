"""A module shadowed by a same-named package must still be reachable.

When ``app/services/foo.py`` sits next to a package ``app/services/foo/``, the
package **always wins**: Python's ``FileFinder`` checks directories before file
extensions, so ``import app.services.foo`` can never reach the ``.py``.  The
file keeps being linted, type-checked and read by humans, while being dead.

That is not automatically a defect -- ``app/worker/tasks/__init__.py`` shadows
``app/worker/tasks.py`` *deliberately* and then loads it by path with
``importlib.util.spec_from_file_location``, which is a working (if unusual)
arrangement.  What separates the two cases is whether the shadowing package
loads its shadowed sibling back.

``app/services/email.py`` was the other kind: a 145-line "backwards-compatible
facade" that no package loaded and no module imported, unreachable since the
``app/services/email/`` package was introduced.  It was deleted in the
follow-up to qontinui-web#1189, which applied the same zero-importers rule to
``app/services/secrets_manager.py``.

Written in the "ban the dead pattern" idiom of ``test_no_fastembed_import.py``
and ``test_no_celery_import.py``: a guard that holds by inspection rather than
only when a rare branch runs.
"""

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent / "app"


def _package_loads_sibling(init_py: Path, module_filename: str) -> bool:
    """True when ``init_py`` loads ``module_filename`` via a path-based import.

    Requires BOTH signals, so a passing mention in a comment or docstring is not
    enough: a ``spec_from_file_location`` call somewhere in the module, and the
    sibling's filename present as a string constant.
    """
    tree = ast.parse(init_py.read_text(encoding="utf-8"), filename=str(init_py))

    def _is_spec_call(node: ast.AST) -> bool:
        # Both spellings: importlib.util.spec_from_file_location(...) and a
        # bare spec_from_file_location(...) after a from-import. Missing the
        # second would report a live module as dead.
        if not isinstance(node, ast.Call):
            return False
        if isinstance(node.func, ast.Attribute):
            return node.func.attr == "spec_from_file_location"
        if isinstance(node.func, ast.Name):
            return node.func.id == "spec_from_file_location"
        return False

    has_spec_call = any(_is_spec_call(node) for node in ast.walk(tree))
    names_the_file = any(
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value == module_filename
        for node in ast.walk(tree)
    )
    return has_spec_call and names_the_file


def test_every_shadowed_module_is_still_loaded():
    """A shadowed ``foo.py`` is dead unless ``foo/__init__.py`` loads it back."""
    dead: list[str] = []

    for init_py in sorted(APP_ROOT.rglob("__init__.py")):
        package = init_py.parent
        shadowed = package.parent / f"{package.name}.py"
        if not shadowed.is_file():
            continue
        if _package_loads_sibling(init_py, shadowed.name):
            continue
        dead.append(str(shadowed.relative_to(APP_ROOT.parent)).replace("\\", "/"))

    assert not dead, (
        "These modules are shadowed by a same-named package and nothing loads "
        "them back, so no import can reach them -- delete them rather than "
        "leaving them to be linted and read as if they were live: " + ", ".join(dead)
    )
