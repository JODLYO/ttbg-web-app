from django.shortcuts import render
from django.contrib.auth.models import User
from django.contrib.auth import login
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect
from django.views.decorators.cache import never_cache


def generate_unique_username(base_username: str) -> str:
    """Generate a unique username by appending a number if needed."""
    if not User.objects.filter(username=base_username).using("default").exists():
        return base_username

    pattern = f"{base_username}#"
    existing_users = User.objects.filter(username__startswith=pattern).using("default")

    if not existing_users.exists():
        return f"{base_username}#0000"

    numbers = [int(user.username.split("#")[1]) for user in existing_users]

    used_numbers = set(numbers)
    next_number = 0
    while next_number in used_numbers:
        next_number += 1

    return f"{base_username}#{next_number:04d}"


@never_cache
def home(request: HttpRequest) -> HttpResponse:
    """Render the landing page and handle the form used to join a game."""

    if request.method == "POST":
        game_mode = request.POST.get("game_mode", "lobby")

        if not request.user.is_authenticated:
            username = request.POST.get("username")
            if not username:
                return render(
                    request, "home/home.html", {"error": "This field is required."}
                )
            unique_username = generate_unique_username(username)
            user, _ = User.objects.get_or_create(username=unique_username)
            login(request, user, "django.contrib.auth.backends.ModelBackend")
            current_username = user.username
        else:
            current_username = request.user.username

        if game_mode == "dragon_forest":
            return redirect("dragon-in-the-forest:lobby")
        if game_mode == "hive":
            return redirect("hive:lobby")
        if game_mode == "single":
            return redirect("set-game:single_player_game_ws", username=current_username)
        return redirect("set-game:lobby")

    return render(request, "home/home.html")
