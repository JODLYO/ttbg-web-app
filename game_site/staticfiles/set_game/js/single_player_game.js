let selectedCards = [];
let playerIds = null;
let sessionId = null;
let currentGameState = null;
let isProcessingMove = false;
let gameSocket = null;
let gameStartTime = null;
let timerInterval = null;
const TARGET_SETS = 10;
let localSetsFound = 0;

const lobbyId = document.getElementById('lobby-id').getAttribute('data-lobby-id');
const currentUsername = document.getElementById('current-username').getAttribute('data-username');

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
                data.state.scores = { [currentUsername]: 0 };
                currentGameState = data.state;
                gameStartTime = null;
                selectedCards = [];
                isProcessingMove = false;
                showGameElements();
                updateGameState(data.state);
                break;
            case 'game_over':
                handleGameOver();
                break;
        }
    };

    gameSocket.onclose = function (e) {
        console.error('Socket closed unexpectedly');
    };
}

function startGame(lobbyId) {
    localSetsFound = 0;
    gameSocket.send(JSON.stringify({
        'type': 'start_game',
        'lobby_id': lobbyId,
    }));
}

function toggleCardSelection(card) {
    const cardId = card.getAttribute('data-card-id');
    const index = selectedCards.indexOf(cardId);

    if (index === -1) {
        if (selectedCards.length < 3) {
            selectedCards.push(cardId);
            card.classList.add('selected');
        }
    } else {
        selectedCards.splice(index, 1);
        card.classList.remove('selected');
    }

    if (selectedCards.length === 3) {
        checkSet();
    }
}

function checkSet() {
    if (selectedCards.length !== 3) return;

    const cards = selectedCards.map(id => {
        const cardElement = document.querySelector(`.card[data-card-id="${id}"]`);
        if (!cardElement) {
            return null;
        }
        return {
            number: parseInt(cardElement.getAttribute('data-number')),
            shading: cardElement.getAttribute('data-shading'),
            color: cardElement.getAttribute('data-color'),
            symbol: cardElement.getAttribute('data-symbol')
        };
    });

    if (cards.some(card => card === null)) return;

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

function createCardElement(cardId, cardData) {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-card-id', cardId);
    card.setAttribute('data-number', cardData.number);
    card.setAttribute('data-symbol', cardData.symbol);
    card.setAttribute('data-shading', cardData.shading);
    card.setAttribute('data-color', cardData.color);

    const cardContent = document.createElement('div');
    cardContent.className = 'card-content';

    for (let i = 0; i < cardData.number; i++) {
        const symbol = document.createElement('div');
        symbol.className = `symbol ${cardData.symbol.toLowerCase()} ${cardData.shading.toLowerCase()} color-${cardData.color.toLowerCase()}`;
        cardContent.appendChild(symbol);
    }

    card.appendChild(cardContent);
    card.onclick = () => toggleCardSelection(card);
    return card;
}

// ===== Game State Management =====
function updateGameState(state) {
    // Clear selected cards
    selectedCards.forEach(cardId => {
        const cardElement = document.querySelector(`.card[data-card-id="${cardId}"]`);
        if (cardElement) {
            cardElement.classList.remove('selected');
        }
    });
    selectedCards = [];

    // Update board
    const boardContainer = document.getElementById('game-board');
    boardContainer.innerHTML = '';

    const numCards = Object.keys(state.board).length;
    const numColumns = numCards === 15 ? 5 : 4;
    boardContainer.style.gridTemplateColumns = `repeat(${numColumns}, 1fr)`;

    Object.entries(state.board).forEach(([pos, cardId]) => {
        const cardData = state.cards[cardId];
        if (!cardData) {
            console.error(`Card data not found for ID: ${cardId}`);
            return;
        }
        const cardElement = createCardElement(cardId, cardData);
        boardContainer.appendChild(cardElement);
    });

    // Start timer if not already started
    if (!gameStartTime) {
        gameStartTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
    }

    // Update sets counter
    document.getElementById('sets-found').textContent = localSetsFound;
    document.getElementById('target-sets').textContent = TARGET_SETS;

    // Check game over condition
    if (localSetsFound >= TARGET_SETS) {
        handleGameOver();
    }
}

function showGameElements() {
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('game-info').style.display = 'block';
    document.getElementById('game-over-container').style.display = 'none';
}

function handleGameOver() {
    stopTimer();
    const gameOverContainer = document.getElementById('game-over-container');
    const finalTime = document.getElementById('final-time');
    gameOverContainer.style.display = 'block';
    finalTime.textContent = document.getElementById('elapsed-time').textContent;

    document.getElementById('game-container').style.display = 'none';
    document.getElementById('game-info').style.display = 'none';

    const backButton = document.querySelector('.game-button');
    if (backButton) {
        backButton.textContent = 'Play Again';
        backButton.onclick = function (e) {
            e.preventDefault();
            localSetsFound = 0;
            gameSocket.send(JSON.stringify({
                'type': 'start_game',
                'lobby_id': lobbyId,
            }));
        };
    }
}

// ===== Timer Management =====
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function updateTimer() {
    if (!gameStartTime) return;
    const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
    document.getElementById('elapsed-time').textContent = formatTime(elapsedSeconds);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
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

    if (!currentGameState || !currentGameState.board) {
        console.error('Current game state or board is not defined.');
        return;
    }

    const boardCardIds = Object.values(currentGameState.board).map(id => String(id));
    if (!cardIds.every(id => boardCardIds.includes(id))) {
        console.error('Invalid card IDs: not all cards are on the board.');
        return;
    }

    isProcessingMove = true;
    gameSocket.send(JSON.stringify({
        'type': 'make_move',
        'session_id': sessionId,
        'username': username,
        'card_ids': cardIds.map(id => parseInt(id))
    }));

    localSetsFound++;
}

document.addEventListener('DOMContentLoaded', function () {
    setupWebSocket();
}); 