from django.core.management.base import BaseCommand
from set_game.models import Card


class Command(BaseCommand):
    help = "Delete all existing SET game cards"

    def handle(self, *args, **kwargs):
        Card.objects.all().delete()
        self.stdout.write(self.style.SUCCESS("Successfully deleted all SET game cards"))
