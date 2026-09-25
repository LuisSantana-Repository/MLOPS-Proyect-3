"""Configuración validada del entrenador.

Los nombres y rangos de este esquema son el contrato con la API del portal (T09)
y el formulario de Training (T11): exporta el JSON Schema con
``python -m trainer --export-schema config.schema.json`` y replica los mismos
límites en Zod.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_SEED = 2**32 - 1


class TrainConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # --- Datos -----------------------------------------------------------------
    manifest_path: Path = Field(
        description="manifest.csv de T04 (crop_path, category_name, split, ...).",
    )
    classes_path: Path | None = Field(
        default=None,
        description="classes.json congelado por T03 ({'0': 'clase', ...}). "
        "Si falta, las clases se derivan del split train en orden alfabético.",
    )
    data_root: Path | None = Field(
        default=None,
        description="Carpeta base de crop_path relativos. Por defecto, la carpeta del manifiesto.",
    )
    output_dir: Path = Field(description="Carpeta donde se escribe el paquete del modelo.")

    # --- Los 7 hiperparámetros de la rúbrica ------------------------------------
    optimizer: Literal["sgd", "adam", "adamw"] = "adamw"
    batch_size: int = Field(default=32, ge=1, le=1024)
    max_epochs: int = Field(default=30, ge=1, le=500)
    lr: float = Field(default=1e-3, gt=0, le=1)
    img_size: int = Field(default=224, ge=32, le=512)
    hidden_layers: list[int] = Field(
        default_factory=lambda: [256],
        max_length=4,
        description="Neuronas por capa oculta de la cabeza MLP; [] = capa lineal directa.",
    )
    dropout: float = Field(default=0.3, ge=0, lt=1)

    # --- Semillas separadas ----------------------------------------------------
    shuffle_seed: int = Field(default=42, ge=0, le=MAX_SEED)
    aug_seed: int = Field(default=43, ge=0, le=MAX_SEED)
    init_seed: int = Field(default=44, ge=0, le=MAX_SEED)

    # --- Early stopping --------------------------------------------------------
    monitor: Literal["val_loss", "val_acc"] = "val_loss"
    patience: int = Field(default=5, ge=1, le=100)
    min_delta: float = Field(default=0.0, ge=0)

    # --- Modelo ----------------------------------------------------------------
    backbone: Literal["resnet18"] = "resnet18"
    pretrained: bool = Field(
        default=True,
        description="Inicia el backbone con torchvision ResNet18_Weights.IMAGENET1K_V1.",
    )
    trainable_backbone: Literal["none", "layer4", "all"] = Field(
        default="none",
        description="none = solo la cabeza entrena; layer4 = además el último bloque; all = fine-tune completo.",
    )

    # --- Optimizador (secundarios) ---------------------------------------------
    momentum: float = Field(default=0.9, ge=0, lt=1, description="Solo aplica a sgd.")
    weight_decay: float = Field(default=0.0, ge=0, le=1)

    # --- Ejecución -------------------------------------------------------------
    device: Literal["auto", "cpu", "cuda"] = "auto"
    num_workers: int = Field(default=0, ge=0, le=32)
    deterministic: bool = True
    max_samples_per_class: int | None = Field(
        default=None,
        ge=1,
        description="Límite por clase y split (lo usa --smoke). None = todos.",
    )

    @field_validator("hidden_layers")
    @classmethod
    def _positive_layers(cls, value: list[int]) -> list[int]:
        for units in value:
            if not 1 <= units <= 4096:
                raise ValueError(f"cada capa oculta debe tener entre 1 y 4096 neuronas; recibí {units}")
        return value

    def to_json_dict(self) -> dict[str, Any]:
        return json.loads(self.model_dump_json())


def load_config(path: str | Path, overrides: dict[str, Any] | None = None) -> TrainConfig:
    """Lee un YAML/JSON, aplica overrides y valida."""
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        data = yaml.safe_load(text) or {}
    elif path.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        raise ValueError(f"formato de config no soportado: {path.suffix} (usa .yaml, .yml o .json)")
    if not isinstance(data, dict):
        raise ValueError("la config debe ser un objeto clave/valor")
    data.update(overrides or {})
    return TrainConfig.model_validate(data)


def export_json_schema(path: str | Path) -> None:
    Path(path).write_text(
        json.dumps(TrainConfig.model_json_schema(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
