# Calibration corpus

Place representative private PNG, JPEG, and WebP files in this directory. Nested directory names become categories in the contact sheet.

Use source images you can inspect closely. Do not add generated calibration output here; the runner writes timestamped runs under `calibration/output/`, which is ignored.

Suggested categories:

- `photo/`: faces, hair, foliage, texture, low light, and gradients
- `logo/`: flat colors, transparency, sharp edges, and small text
- `illustration/`: outlines, color regions, and soft shading
- `screenshot/`: UI text and one-pixel lines
- `edge-cases/`: EXIF rotation, very wide/tall images, alpha, and small inputs
