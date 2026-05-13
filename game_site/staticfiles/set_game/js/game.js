let selectedCards = [];
let playerIds = null;
let sessionId = null;
let currentGameState = null;
let isProcessingMove = false;
let gameSocket = null;

const lobbyId = document.getElementById('lobby-id').dataset.lobbyId;
const currentUsername = document.getElementById('current-username').dataset.lobbyId;

const gameStateId = window.setGameData && window.setGameData.gameStateId ? window.setGameData.gameStateId : null;

function setupWebSocket() {
    if (gameSocket) {
        gameSocket.close();
    }
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsPath = gameStateId ? `/ws/set/game/${gameStateId}/` : `/ws/game/`;
    gameSocket = new WebSocket(`${protocol}://${window.location.host}${wsPath}`);

    gameSocket.onopen = function () {
        startGame(lobbyId);
    };

    gameSocket.onmessage = function (e) {
        const data = JSON.parse(e.data);

        switch (data.type) {
            case 'game_state':
                currentGameState = data.state;
                updateGameState(data.state);
                isProcessingMove = false;
                break;
            case 'game_started':
                sessionId = data.session_id;
                playerIds = data.player_ids;
                currentGameState = data.state;
                updateGameState(data.state);
                isProcessingMove = false;
                break;
            case 'game_over':
                alert('Game over! No more sets are possible.');
                // Show the rematch button when the game is over
                const rematchContainer = document.getElementById('rematch-container');
                if (rematchContainer) {
                    rematchContainer.style.display = 'block';

                    // Reset the rematch button state
                    const rematchButton = document.getElementById('rematch-button');
                    if (rematchButton) {
                        rematchButton.disabled = false;
                        rematchButton.textContent = 'Request Rematch';
                    }
                }
                break;
            case 'rematch_status':
                updateRematchStatus(data.rematch_status);
                break;
        }
    };

    gameSocket.onclose = function (e) {
        // Socket closed
    };
}

function startGame(lobbyId) {
    gameSocket.send(JSON.stringify({
        'type': 'start_game',
        'lobby_id': lobbyId,
    }));
}

function monitorSelectedCards() {
    if (selectedCards.length === 3) {
        checkSet();
    }
}

function checkSet() {
    if (selectedCards.length !== 3) {
        return;
    }

    const cards = selectedCards.map(id => {
        const cardElement = document.querySelector(`.card[data-card-id="${id}"]`);
        if (!cardElement) {
            console.error(`Card with ID ${id} not found.`);
            return null;
        }
        return {
            number: parseInt(cardElement.getAttribute('data-number')),
            shading: cardElement.getAttribute('data-shading'),
            color: cardElement.getAttribute('data-color'),
            symbol: cardElement.getAttribute('data-symbol')
        };
    });

    // Check if any card is null
    if (cards.some(card => card === null)) {
        document.getElementById('message').innerText = 'Error: One or more cards not found.';
        return;
    }

    const isValid = isValidSet(cards);
    if (isValid) {
        sendMove(currentUsername, selectedCards);
    }

    // Reset selected cards
    selectedCards.forEach(cardId => {
        const cardElement = document.querySelector(`.card[data-card-id="${cardId}"]`);
        if (cardElement) {
            cardElement.classList.remove('selected');
        }
    });
    selectedCards = [];
}

function isValidSet(cards) {
    const numbers = new Set(cards.map(card => card.number));
    const symbols = new Set(cards.map(card => card.symbol));
    const shadings = new Set(cards.map(card => card.shading));
    const colors = new Set(cards.map(card => card.color));

    return (numbers.size === 1 || numbers.size === 3) &&
        (symbols.size === 1 || symbols.size === 3) &&
        (shadings.size === 1 || shadings.size === 3) &&
        (colors.size === 1 || colors.size === 3);
}

function updateGameState(state) {

    // Clear any selected cards when the game state updates
    selectedCards.forEach(cardId => {
        const cardElement = document.querySelector(`.card[data-card-id="${cardId}"]`);
        if (cardElement) {
            cardElement.classList.remove('selected');
        }
    });
    selectedCards = [];

    // Hide the rematch UI when a new game starts
    const rematchContainer = document.getElementById('rematch-container');
    if (rematchContainer) {
        rematchContainer.style.display = 'none';

        // Reset the rematch button state when a new game starts
        const rematchButton = document.getElementById('rematch-button');
        if (rematchButton) {
            rematchButton.disabled = false;
            rematchButton.textContent = 'Request Rematch';
        }
    }

    // Update the board
    const boardContainer = document.getElementById('game-board');
    boardContainer.innerHTML = '';  // Clear current board

    // Determine the number of columns based on the number of cards
    const numCards = Object.keys(state.board).length;
    const numColumns = numCards === 15 ? 5 : 4; // 5 columns for 15 cards, 4 columns for 12 cards

    // Update the grid layout
    boardContainer.style.gridTemplateColumns = `repeat(${numColumns}, 1fr)`;

    // Append cards to the board
    Object.entries(state.board).forEach(([pos, cardId]) => {
        const cardData = state.cards[cardId];
        if (!cardData) {
            console.error(`Card data not found for ID: ${cardId}`);
            return;
        }
        const cardElement = createCardElement(cardId, cardData);
        boardContainer.appendChild(cardElement);
    });

    // Update the scores
    const scoresContainer = document.getElementById('scores');
    scoresContainer.innerHTML = '';  // Clear current scores

    // Dynamically create score elements for each player
    Object.entries(state.scores).forEach(([playerId, score]) => {
        const scoreElement = document.createElement('div');
        scoreElement.id = `player-${playerId}-score`;
        scoreElement.innerText = `Player ${playerId}: ${score}`;
        scoresContainer.appendChild(scoreElement);
    });

    // Clear the message
    document.getElementById('message').innerText = '';
}

function createCardElement(cardId, cardData) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.setAttribute('data-card-id', cardId);
    cardElement.setAttribute('data-number', cardData.number);
    cardElement.setAttribute('data-symbol', cardData.symbol);
    cardElement.setAttribute('data-shading', cardData.shading);
    cardElement.setAttribute('data-color', cardData.color);

    const cardContent = document.createElement('div');
    cardContent.classList.add('card-content');

    // Add symbols based on the number
    for (let i = 0; i < cardData.number; i++) {
        const symbol = document.createElement('div');
        symbol.classList.add('symbol', cardData.symbol.toLowerCase(), 'shading', cardData.shading.toLowerCase(), 'color', `color-${cardData.color.toLowerCase()}`);
        cardContent.appendChild(symbol);
    }

    cardElement.appendChild(cardContent);

    cardElement.addEventListener('click', () => {
        const cardId = cardElement.getAttribute('data-card-id');
        if (selectedCards.includes(cardId)) {
            selectedCards = selectedCards.filter(id => id !== cardId);
            cardElement.classList.remove('selected');
        } else {
            selectedCards.push(cardId);
            cardElement.classList.add('selected');
        }
        monitorSelectedCards();
    });

    return cardElement;
}

function sendMove(username, cardIds) {
    if (isProcessingMove) {
        console.error('A move is already being processed.');
        return;
    }
    if (!sessionId) {
        console.error('Session ID is not set.');
        return;
    }
    if (!username) {
        console.error('Username is not set.');
        return;
    }

    // Validate card IDs against the current board state
    if (!currentGameState || !currentGameState.board) {
        console.error('Current game state or board is not defined.');
        return;
    }

    // Validate card IDs against the current board state
    const boardCardIds = Object.values(currentGameState.board).map(id => String(id));
    if (!cardIds.every(id => boardCardIds.includes(id))) {
        return;
    }

    isProcessingMove = true;
    gameSocket.send(JSON.stringify({
        'type': 'make_move',
        'session_id': sessionId,
        'username': username,
        'card_ids': cardIds.map(id => parseInt(id))
    }));
}

function requestRematch() {
    if (!sessionId) {
        console.error('Session ID is not set.');
        return;
    }
    if (!currentUsername) {
        console.error('Username is not set.');
        return;
    }

    gameSocket.send(JSON.stringify({
        'type': 'request_rematch',
        'session_id': sessionId,
        'username': currentUsername
    }));

const rematchButton = document.getElementById('rematch-button');
    if (rematchButton) {
        rematchButton.disabled = true;
        rematchButton.textContent = 'Rematch Requested';
    }
}

function updateRematchStatus(rematchStatus) {
    const rematchStatusElement = document.getElementById('rematch-status');
    if (!rematchStatusElement) return;

    const readyPlayers = Object.values(rematchStatus).filter(status => status).length;

    const totalPlayers = playerIds ? playerIds.length : Object.keys(rematchStatus).length;

    if (readyPlayers === totalPlayers) {
        rematchStatusElement.textContent = 'All players ready! Starting new game...';
    } else {
        rematchStatusElement.textContent = `${readyPlayers} out of ${totalPlayers} players ready for rematch`;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const rematchButton = document.getElementById('rematch-button');
    if (rematchButton) {
        rematchButton.addEventListener('click', requestRematch);
    }

    setupWebSocket();
});