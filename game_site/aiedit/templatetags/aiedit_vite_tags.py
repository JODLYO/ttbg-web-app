import json
import os
from django import template
from django.conf import settings

register = template.Library()


@register.simple_tag
def aiedit_vite_asset(entry: str, asset_type: str = "js") -> str | None:
    manifest_path = os.path.join(
        settings.BASE_DIR,
        "aiedit",
        "static",
        "aiedit",
        "react",
        "dist",
        ".vite",
        "manifest.json",
    )

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        if entry not in manifest:
            raise KeyError(entry)
        if asset_type == "js":
            return "aiedit/react/dist/" + manifest[entry]["file"]
        elif asset_type == "css":
            css_files = manifest[entry].get("css", [])
            if css_files:
                return "aiedit/react/dist/" + css_files[0]
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        return f"<!-- aiedit_vite_asset error: {e} -->"
    return ""
