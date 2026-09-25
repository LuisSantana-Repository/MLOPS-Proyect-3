from __future__ import annotations

import pytest
import torch
from torch import nn

from trainer.model import CropClassifier, arch_spec, build_from_arch


def _head_layout(model: CropClassifier) -> list[tuple[str, object]]:
    layout = []
    for layer in model.head:
        if isinstance(layer, nn.Linear):
            layout.append(("linear", (layer.in_features, layer.out_features)))
        elif isinstance(layer, nn.Dropout):
            layout.append(("dropout", layer.p))
        else:
            layout.append((type(layer).__name__.lower(), None))
    return layout


def test_head_follows_hidden_layers_and_dropout() -> None:
    model = CropClassifier(4, [64, 32], 0.25, pretrained=False)
    assert _head_layout(model) == [
        ("linear", (512, 64)),
        ("relu", None),
        ("dropout", 0.25),
        ("linear", (64, 32)),
        ("relu", None),
        ("dropout", 0.25),
        ("linear", (32, 4)),
    ]
    assert model(torch.zeros(2, 3, 32, 32)).shape == (2, 4)


def test_empty_hidden_layers_gives_linear_head() -> None:
    model = CropClassifier(3, [], 0.1, pretrained=False)
    assert _head_layout(model) == [("dropout", 0.1), ("linear", (512, 3))]


@pytest.mark.parametrize(
    ("mode", "expected_prefixes"),
    [("none", {"head"}), ("layer4", {"head", "backbone.layer4"}), ("all", {"head", "backbone"})],
)
def test_trainable_backbone_controls_requires_grad(mode: str, expected_prefixes: set[str]) -> None:
    model = CropClassifier(3, [8], 0.0, pretrained=False, trainable_backbone=mode)
    for name, param in model.named_parameters():
        assert param.requires_grad == any(name.startswith(p) for p in expected_prefixes), name


def test_frozen_batchnorm_stays_in_eval_mode() -> None:
    model = CropClassifier(3, [8], 0.0, pretrained=False, trainable_backbone="layer4").train()
    assert not model.backbone.bn1.training
    assert model.backbone.layer4.training
    assert model.head.training


def test_init_seed_controls_head_initialisation() -> None:
    def head_weight(seed: int) -> torch.Tensor:
        torch.manual_seed(seed)
        return CropClassifier(3, [8], 0.0, pretrained=False).head[0].weight.detach().clone()

    assert torch.equal(head_weight(1), head_weight(1))
    assert not torch.equal(head_weight(1), head_weight(2))


def test_build_from_arch_rebuilds_the_same_shapes() -> None:
    model = CropClassifier(5, [16], 0.2, pretrained=False, trainable_backbone="layer4")
    rebuilt = build_from_arch(arch_spec(5, [16], 0.2, "layer4"))
    rebuilt.load_state_dict(model.state_dict())
    model.eval()
    rebuilt.eval()
    x = torch.randn(1, 3, 40, 40)
    assert torch.equal(model(x), rebuilt(x))
