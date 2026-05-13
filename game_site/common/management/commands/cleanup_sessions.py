from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from set_game.models import GameSession, GameSessionSingle


class Command(BaseCommand):
    help = "Cleans up stale set game sessions"

    def add_arguments(self, parser):
        parser.add_argument(
            "--minutes",
            type=int,
            default=60,
            help="Number of minutes after which a session is considered stale",
        )

    def handle(self, *args, **options):
        cutoff_time = timezone.now() - timedelta(minutes=options["minutes"])

        multiplayer_sessions = GameSession.objects.filter(created_at__lt=cutoff_time)
        multiplayer_count = multiplayer_sessions.count()
        multiplayer_sessions.delete()

        single_player_sessions = GameSessionSingle.objects.filter(
            created_at__lt=cutoff_time
        )
        single_player_count = single_player_sessions.count()
        single_player_sessions.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully cleaned up {multiplayer_count} multiplayer sessions and "
                f"{single_player_count} single player sessions older than {options['minutes']} minutes"
            )
        )
