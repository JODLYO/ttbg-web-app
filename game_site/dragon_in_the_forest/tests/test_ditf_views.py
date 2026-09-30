import json
from pathlib import Path

import pytest
from django.test import Client
from django.urls import reverse

APP_DIR = Path(__file__).resolve().parent.parent


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url_name, mode",
    [("vs_computer", "vs_computer"), ("analysis", "analysis")],
)
def test_bot_pages_render_without_login(url_name, mode):
    """Both bot boards run entirely client-side, so anyone can open them."""
    response = Client().get(reverse(f"dragon-in-the-forest:{url_name}"))
    assert response.status_code == 200
    content = response.content.decode()
    assert f'mode: "{mode}"' in content
    assert "/static/dragon_in_the_forest/react/dist/assets/main-" in content


def test_home_page_links_to_bot_modes():
    from django.template.loader import render_to_string

    html = render_to_string("home/home.html", {"user": None}, request=None)
    assert reverse("dragon-in-the-forest:vs_computer") in html
    assert reverse("dragon-in-the-forest:analysis") in html


def test_value_net_weights_ship_with_the_react_build():
    """The bot worker fetches this file at runtime; a build without it would leave the
    computer opponent and the analysis board with nothing to load."""
    for path in (
        APP_DIR / "react" / "public" / "models" / "value_net.json",
        APP_DIR
        / "static"
        / "dragon_in_the_forest"
        / "react"
        / "dist"
        / "models"
        / "value_net.json",
    ):
        net = json.loads(path.read_text())
        assert net["format"] == 1
        assert net["inputDim"] == 235
        layers = net["layers"]
        assert [layer["in"] for layer in layers][0] == 235
        assert layers[-1]["out"] == 1
