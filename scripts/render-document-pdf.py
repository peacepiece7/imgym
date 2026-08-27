#!/usr/bin/env python3
"""Render trusted, locally generated HTML as a tagged PDF/UA-1 document."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

try:
    import resource
except ImportError:  # Windows retains the parent timeout and output checks.
    resource = None

EXPECTED_WEASYPRINT_VERSION = "68.1"
MAX_HTML_BYTES = 6 * 1024 * 1024
MAX_PDF_BYTES = 24 * 1024 * 1024
MAX_PAGES = 100


def apply_process_limits() -> None:
    if resource is None:
        return
    gibibyte = 1024 * 1024 * 1024
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (2 * gibibyte, 2 * gibibyte))
    resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PDF_BYTES + 1024, MAX_PDF_BYTES + 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def blocked_url_fetcher(url: str, *args: object, **kwargs: object) -> dict[str, object]:
    del args, kwargs
    raise ValueError(f"External resources are disabled: {url[:80]}")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main() -> int:
    apply_process_limits()
    args = arguments()
    input_path = Path(args.input)
    output_path = Path(args.output)

    input_bytes = input_path.read_bytes()
    if not input_bytes or len(input_bytes) > MAX_HTML_BYTES:
        raise ValueError("HTML input exceeded the limit")
    html = input_bytes.decode("utf-8", errors="strict")

    from weasyprint import HTML, __version__

    if __version__ != EXPECTED_WEASYPRINT_VERSION:
        raise RuntimeError(
            f"WeasyPrint {EXPECTED_WEASYPRINT_VERSION} is required, found {__version__}"
        )

    document = HTML(string=html, url_fetcher=blocked_url_fetcher).render()
    page_count = len(document.pages)
    if page_count < 1 or page_count > MAX_PAGES:
        raise ValueError("PDF page count exceeded the limit")

    document.write_pdf(
        target=str(output_path),
        pdf_variant="pdf/ua-1",
        srgb=True,
    )
    output_bytes = output_path.stat().st_size
    if output_bytes < 5 or output_bytes > MAX_PDF_BYTES:
        output_path.unlink(missing_ok=True)
        raise ValueError("PDF output exceeded the limit")

    print(json.dumps({
        "pages": page_count,
        "renderer": f"WeasyPrint {__version__}",
        "variant": "PDF/UA-1",
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"document rendering failed: {error}", file=sys.stderr)
        raise SystemExit(1)
