"""ResNet18 con cabeza MLP propia, y carga del paquete guardado.

``load_model`` es el punto de entrada común para evaluación (T08) e inferencia
(T10): reconstruye la arquitectura desde ``weights.pt`` sin descargar pesos de
internet y devuelve el mismo transform de evaluación usado en validación.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from torch import nn
from torchvision.models import ResNet18_Weights, resnet18
from torchvision.transforms import Compose

from trainer.data import build_eval_transform, read_classes

CHECKPOINT_FORMAT_VERSION = 1
PRETRAINED_WEIGHTS = ResNet18_Weights.IMAGENET1K_V1


def pretrained_source(pretrained: bool) -> dict[str, Any]:
    if not pretrained:
        return {"pretrained": False, "source": "inicialización aleatoria (init_seed)"}
    return {
        "pretrained": True,
        "source": f"torchvision.models.{PRETRAINED_WEIGHTS}",
        "url": PRETRAINED_WEIGHTS.url,
        "dataset": "ImageNet-1k",
    }


class CropClassifier(nn.Module):
    def __init__(
        self,
        num_classes: int,
        hidden_layers: list[int],
        dropout: float,
        pretrained: bool = True,
        trainable_backbone: str = "none",
    ) -> None:
        super().__init__()
        if num_classes < 2:
            raise ValueError("num_classes debe ser >= 2")
        self.backbone = resnet18(weights=PRETRAINED_WEIGHTS if pretrained else None)
        in_features = self.backbone.fc.in_features
        self.backbone.fc = nn.Identity()

        layers: list[nn.Module] = []
        width = in_features
        for units in hidden_layers:
            layers += [nn.Linear(width, units), nn.ReLU(inplace=True), nn.Dropout(dropout)]
            width = units
        if not hidden_layers:
            layers.append(nn.Dropout(dropout))
        layers.append(nn.Linear(width, num_classes))
        self.head = nn.Sequential(*layers)

        self.trainable_backbone = trainable_backbone
        self._frozen = self._apply_freeze(trainable_backbone)

    def _apply_freeze(self, mode: str) -> list[nn.Module]:
        if mode == "all":
            return []
        if mode not in {"none", "layer4"}:
            raise ValueError(f"trainable_backbone no válido: {mode}")
        frozen = [m for name, m in self.backbone.named_children() if not (mode == "layer4" and name == "layer4")]
        for module in frozen:
            for param in module.parameters():
                param.requires_grad = False
        return frozen

    def train(self, mode: bool = True) -> CropClassifier:
        super().train(mode)
        # Las partes congeladas se quedan en eval para no mover sus estadísticas de BatchNorm.
        for module in self._frozen:
            module.eval()
        return self

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.backbone(x))


def arch_spec(num_classes: int, hidden_layers: list[int], dropout: float, trainable_backbone: str) -> dict[str, Any]:
    return {
        "backbone": "resnet18",
        "num_classes": num_classes,
        "hidden_layers": list(hidden_layers),
        "dropout": dropout,
        "trainable_backbone": trainable_backbone,
    }


def build_from_arch(arch: dict[str, Any]) -> CropClassifier:
    if arch.get("backbone") != "resnet18":
        raise ValueError(f"backbone no soportado: {arch.get('backbone')}")
    return CropClassifier(
        num_classes=arch["num_classes"],
        hidden_layers=arch["hidden_layers"],
        dropout=arch["dropout"],
        pretrained=False,  # los pesos vienen del checkpoint
        trainable_backbone=arch["trainable_backbone"],
    )


def save_checkpoint(path: Path, model: CropClassifier, arch: dict[str, Any], classes: list[str], extra: dict) -> None:
    torch.save(
        {
            "format_version": CHECKPOINT_FORMAT_VERSION,
            "arch": arch,
            "classes": classes,
            "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
            **extra,
        },
        path,
    )


@dataclass
class LoadedModel:
    model: CropClassifier
    classes: list[str]
    transform: Compose
    preprocess: dict[str, Any]
    checkpoint_meta: dict[str, Any]


def load_model(package_dir: str | Path, device: str | torch.device = "cpu") -> LoadedModel:
    """Carga weights.pt + classes.json + preprocess.json en modo eval."""
    package_dir = Path(package_dir)
    ckpt = torch.load(package_dir / "weights.pt", map_location="cpu", weights_only=True)
    if ckpt.get("format_version") != CHECKPOINT_FORMAT_VERSION:
        raise ValueError(f"weights.pt con format_version no soportado: {ckpt.get('format_version')}")
    classes = read_classes(package_dir / "classes.json")
    if classes != ckpt["classes"]:
        raise ValueError("classes.json no coincide con las clases guardadas en weights.pt")
    preprocess = json.loads((package_dir / "preprocess.json").read_text(encoding="utf-8"))

    model = build_from_arch(ckpt["arch"])
    model.load_state_dict(ckpt["state_dict"])
    model.to(device).eval()
    meta = {k: v for k, v in ckpt.items() if k != "state_dict"}
    return LoadedModel(model, classes, build_eval_transform(preprocess), preprocess, meta)
