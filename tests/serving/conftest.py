"""Fixtures de T10/T16: el paquete real y el bucket moto viven en tests/conftest.py.

``trained_package`` y ``s3_bucket`` las resuelve pytest desde el conftest raíz
(compartidas con tests/e2e). ``TEST_BUCKET`` se define aquí como constante para los
tests que lo importan por nombre (``from tests.serving.conftest import TEST_BUCKET``);
debe coincidir con el del conftest raíz.
"""

from __future__ import annotations

# Debe ser el mismo valor que tests/conftest.py::TEST_BUCKET.
TEST_BUCKET = "test-models-bucket"
