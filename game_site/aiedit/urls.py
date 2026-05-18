from django.urls import path
from django.views.generic import RedirectView
from . import views

app_name = "aiedit"

urlpatterns = [
    path("", RedirectView.as_view(url="/aiedit/about/", permanent=False)),
    path("about/", views.editor_about, name="about"),
    path("edit/", views.image_editor, name="image_editor"),
    path("video/", views.video_editor, name="video_editor"),
]
