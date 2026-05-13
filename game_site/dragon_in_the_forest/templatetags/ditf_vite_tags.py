import json
import os
from django import template
from django.conf import settings

register = template.Library()


@register.simple_tag
def vite_asset(entry: str, asset_type: str = "js") -> str | None:
    """
    Returns the correct path for a Vite-built asset using manifest.json.
    asset_type can be 'js' or 'css'.
    """
    manifest_path = os.path.join(
        settings.BASE_DIR,
        "dragon_in_the_forest",
        "static",
        "dragon_in_the_forest",
        "react",
        "dist",
        ".vite",
        "manifest.json",
    )

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        if entry not in manifest:
            raise ValueError(f"No entry {entry} in manifest.")
        if asset_type == "js":
            return "dragon_in_the_forest/react/dist/" + manifest[entry]["file"]
        elif asset_type == "css":
            css_files = manifest[entry].get("css", [])
            if css_files:
                return "dragon_in_the_forest/react/dist/" + css_files[0]
    except Exception as e:
        return f"<!-- vite_asset error: {e} -->"
    return None
