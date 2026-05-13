from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from django.contrib.auth.models import User
from django.db.models import Q


class Command(BaseCommand):
    help = "Cleans up inactive players across all games"

    def handle(self, *args, **options):
        cutoff_time = timezone.now() - timedelta(days=1)

        users_to_delete = User.objects.exclude(
            Q(lobbyplayer__lobby__last_activity__gte=cutoff_time)
            | Q(lobbyplayer_hive__lobby__last_activity__gte=cutoff_time)
            | Q(lobbyplayer_ditf__lobby__last_activity__gte=cutoff_time)
            | Q(game_sessions__last_activity__gte=cutoff_time)
        ).distinct()

        count = users_to_delete.count()
        users_to_delete.delete()

        self.stdout.write(
            self.style.SUCCESS(f"Successfully cleaned up {count} inactive players")
        )
