from django.core.management.base import BaseCommand
from dragon_in_the_forest.models import Card


class Command(BaseCommand):
    help = "Initialize the deck of cards for Dragon in the Forest"

    def handle(self, *args, **options):
        suits = ["fire", "earth", "water"]
        values = range(1, 12)

        cards_created = 0
        for suit in suits:
            for value in values:
                _, created = Card.objects.get_or_create(suit=suit, value=value)
                if created:
                    cards_created += 1

        self.stdout.write(
            self.style.SUCCESS(f"Successfully created {cards_created} cards")
        )
