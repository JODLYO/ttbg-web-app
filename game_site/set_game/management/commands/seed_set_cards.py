from django.core.management.base import BaseCommand
from set_game.models import Card


class Command(BaseCommand):
    help = "Populate the database with SET game cards"

    def handle(self, *args, **kwargs):
        numbers = [1, 2, 3]
        symbols = ["diamond", "squiggle", "oval"]
        shadings = ["solid", "striped", "open"]
        colors = ["red", "green", "purple"]

        for number in numbers:
            for symbol in symbols:
                for shading in shadings:
                    for color in colors:
                        Card.objects.get_or_create(
                            number=number, symbol=symbol, shading=shading, color=color
                        )

        self.stdout.write(
            self.style.SUCCESS(
                "Successfully populated the database with SET game cards"
            )
        )
