from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from set_game.models import Lobby as SetGameLobby
from hive.models import Lobby as HiveLobby
from dragon_in_the_forest.models import Lobby as DitfLobby


class Command(BaseCommand):
    help = "Cleans up inactive lobbies across all games"

    def handle(self, *args, **options):
        now = timezone.now()
        inactive_cutoff = now - timedelta(minutes=3)
        old_cutoff = now - timedelta(minutes=5)
        total_inactive = 0
        total_old = 0

        for LobbyModel in (SetGameLobby, HiveLobby, DitfLobby):
            inactive = LobbyModel.objects.filter(last_activity__lt=inactive_cutoff)
            total_inactive += inactive.count()
            inactive.delete()

            old = LobbyModel.objects.filter(created_at__lt=old_cutoff)
            total_old += old.count()
            old.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Cleaned up: {total_inactive} inactive lobbies, {total_old} expired lobbies"
            )
        )
