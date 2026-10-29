"""Deterministic, tileable PBR source textures. Requires numpy, scipy and Pillow.

Colour is sRGB. Surface RGB packs roughness / micro-height / cavity visibility
(linear data). These are authored synthetic materials, not photographic scans.
"""
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image, ImageDraw

OUT = Path("public/assets/mobs/textures")
OUT.mkdir(parents=True, exist_ok=True)
N = 512
y, x = np.mgrid[:N, :N]

for seed, kind in enumerate(["skin", "flesh", "cloth", "leather", "bone", "chitin", "rubber"]):
    rng = np.random.default_rng(271828 + seed)

    def noise(sigma):
        a = gaussian_filter(rng.normal(size=(N, N)), sigma, mode="wrap")
        return a / max(a.std(), 0.00001)

    broad, mid, fine = noise(24), noise(5), noise(0.7)
    base = 205 + broad * 7 + mid * 4 + fine * 2
    color = np.stack([base, base * 0.98, base * 0.95], axis=-1)
    height = 0.5 + fine * 0.035 + mid * 0.025
    rough = np.full((N, N), 0.78) + broad * 0.045
    cavity = np.ones((N, N))

    if kind in ("skin", "flesh"):
        # Dermal islands and recessed follicles, rather than uniform white noise.
        follicles = np.zeros((N, N))
        py, px = rng.integers(0, N, (2, 3800))
        follicles[py, px] = rng.uniform(0.3, 1, len(px))
        pores = gaussian_filter(follicles, 0.65, mode="wrap")
        height -= pores * 0.8
        cavity -= pores * 0.7
        color -= pores[..., None] * np.array([26, 30, 28])
        # Sparse branching subcutaneous capillaries; paint across wrap boundaries.
        veins = Image.new("L", (N, N))
        draw = ImageDraw.Draw(veins)
        for _ in range(16):
            start = rng.uniform(0, N, 2)
            direction = rng.uniform(-np.pi, np.pi)
            points = [tuple(start)]
            for step in range(30):
                direction += rng.normal(0, 0.24)
                start = start + [np.cos(direction) * 4, np.sin(direction) * 4]
                points.append(tuple(start))
            for ox in (-N, 0, N):
                for oy in (-N, 0, N):
                    draw.line([(a + ox, b + oy) for a, b in points], fill=85, width=1)
        v = gaussian_filter(np.asarray(veins, dtype=float) / 255, 1.3, mode="wrap")
        color -= v[..., None] * np.array([42, 60, 20])
        bruise = np.maximum(0, broad - 0.6)
        color -= bruise[..., None] * np.array([8, 16, 8])
        if kind == "flesh":
            fibres = (np.sin(y * 0.31 + np.sin(x * 0.045) * 3 + mid * 0.4) + 1) * 0.5
            height += fibres * 0.09
            color *= np.stack([np.ones_like(base), 0.82 + fibres * 0.06, 0.79 + fibres * 0.05], axis=-1)
            rough = 0.45 + mid * 0.08

    elif kind == "cloth":
        warp = np.sin(x * np.pi / 2) ** 6
        weft = np.sin(y * np.pi / 2) ** 6
        weave = np.where((x // 4 + y // 4) % 2 == 0, warp, weft)
        height = 0.35 + weave * 0.24 + fine * 0.025
        color *= (0.87 + weave[..., None] * 0.15)
        stains = np.maximum(0, broad - 0.3)
        color -= stains[..., None] * np.array([16, 19, 22])
        rough = 0.92 + mid * 0.025
    elif kind in ("leather", "rubber", "chitin"):
        # Cellular grain with fine, dark fissures and smoother raised islands.
        cells = noise(3)
        cracks = np.exp(-np.abs(cells) * 16)
        height += np.tanh(cells * 2) * 0.055 - cracks * 0.1
        color -= cracks[..., None] * 40
        cavity -= cracks * 0.3
        rough = 0.6 + cells * 0.07
        if kind == "chitin":
            ridges = (np.sin(y * np.pi / 32 + np.sin(x * np.pi / 128)) + 1) * 0.5
            height += ridges * 0.12
            rough = 0.45 + cracks * 0.25
        if kind == "rubber":
            rough += 0.13
    elif kind == "bone":
        striations = gaussian_filter(rng.normal(size=(N, N)), (9, 0.7), mode="wrap")
        height += striations * 0.1
        color -= np.maximum(0, mid)[..., None] * np.array([3, 8, 17])
        rough = 0.7 + striations * 0.2

    surface = np.stack([rough, height, cavity], axis=-1)
    Image.fromarray(np.clip(color, 0, 255).astype(np.uint8)).save(OUT / f"{kind}-color.png", optimize=True)
    Image.fromarray((np.clip(surface, 0, 1) * 255).astype(np.uint8)).save(OUT / f"{kind}-surface.png", optimize=True)
    print(kind)
