from django.core.management.base import BaseCommand
from hive.models import Piece


class Command(BaseCommand):
    help = "Populate Hive pieces for white and black"

    PIECES = [
        ("queen", 1),
        ("ant", 3),
        ("spider", 2),
        ("beetle", 2),
        ("grasshopper", 3),
    ]

    MOVE_DESCRIPTIONS = {
        "queen": "Moves one adjacent space",
        "ant": "Can move to any open hex around the hive.",
        "spider": "Moves exactly 3 spaces around the hive.",
        "beetle": "Moves 1 space, can climb on top of other pieces.",
        "grasshopper": "Jumps in a straight line over pieces.",
    }

    COLOURS = ["white", "black"]

    def handle(self, *args, **kwargs):
        expected = len(self.COLOURS) * sum(count for _, count in self.PIECES)
        if Piece.objects.count() == expected:
            self.stdout.write("Hive pieces already initialised, skipping.")
            return

        Piece.objects.all().delete()
        for colour in self.COLOURS:
            for piece_type, count in self.PIECES:
                for _ in range(count):
                    Piece.objects.create(
                        colour=colour,
                        piece_type=piece_type,
                        move_description=self.MOVE_DESCRIPTIONS[piece_type],
                    )
        self.stdout.write(self.style.SUCCESS("Hive pieces created for both colours."))
