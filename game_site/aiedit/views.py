from django.shortcuts import render
from django.http import HttpRequest, HttpResponse


def editor_about(request: HttpRequest) -> HttpResponse:
    return render(request, "aiedit/about.html")


def image_editor(request: HttpRequest) -> HttpResponse:
    return render(request, "aiedit/image_editor.html")


def video_editor(request: HttpRequest) -> HttpResponse:
    return render(request, "aiedit/video_editor.html")
