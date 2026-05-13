const MAX_PLAYERS = 2;
const POLL_INTERVAL = 3000;
const INACTIVE_TIMEOUT = 1 * 60 * 1000;
const lobbyId = document.getElementById('lobby-id').dataset.lobbyId;
const readyUrl = document.getElementById('ready-form-container').dataset.readyUrl;
const currentUsername = document.getElementById('current-player').textContent;
const lobbyStatusUrl = document.getElementById('lobby-id').getAttribute('data-lobby-status-url');
const gameUrlTemplate = document.getElementById("game-url").dataset.readyUrl;

function getGameUrl(gameStateId) {
    return gameUrlTemplate.replace(/0\/$/, gameStateId + "/");
}

function updateLobbyStatus(data) {

    if (data.error === "Lobby not found") {
        alert("This lobby has been closed due to inactivity. Redirecting to home...");
        window.location.href = '/';
        return;
    }

    updatePlayerList(data.players);
    updateLobbyUI(data);

    if (data.is_full && data.all_ready && data.game_state_id) {
        window.location.href = `/dragon-forest/game/${data.game_state_id}/`;
    }
}

function updatePlayerList(players) {
    const playersContainer = document.getElementById('players');
    playersContainer.innerHTML = '';

    players.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';

        const playerName = document.createElement('span');
        playerName.className = 'player-name';
        playerName.textContent = player.username;

        const playerStatus = document.createElement('span');
        playerStatus.className = `player-status ${player.ready ? 'status-ready' : 'status-waiting'}`;
        playerStatus.textContent = player.ready ? 'Ready' : 'Waiting';

        playerCard.appendChild(playerName);
        playerCard.appendChild(playerStatus);
        playersContainer.appendChild(playerCard);
    });
}

function updateLobbyUI(data) {
    const waitingMessage = document.getElementById('waiting-message');
    const readyButton = document.getElementById('ready-button');
    const playerCount = document.getElementById('player-count');

    playerCount.textContent = `Players: ${data.players.length}/${MAX_PLAYERS}`;

    if (data.players.length < MAX_PLAYERS) {
        waitingMessage.style.display = 'block';
    } else {
        waitingMessage.style.display = 'none';
    }

    const currentPlayer = data.players.find(p => p.username === currentUsername);
    if (currentPlayer) {
        if (currentPlayer.ready) {
            readyButton.innerHTML = '<button class="game-button" disabled>Ready!</button>';
        } else {
            readyButton.innerHTML = '<button class="game-button" onclick="setReady()">Ready</button>';
        }
    } else {
        readyButton.innerHTML = '<button class="game-button" disabled>Waiting...</button>';
    }
}

function fetchLobbyStatus() {
    fetch(lobbyStatusUrl)
        .then(response => response.json())
        .then(data => {
            if (data.game_state_id) {
                window.location.href = getGameUrl(data.game_state_id);
            } else {
                updateLobbyStatus(data);
            }
        })
        .catch(error => {
            alert("Connection lost. The lobby may have been closed. Redirecting to home...");
            window.location.href = '/';
        });
}

function setReady(readyState = true) {
    fetch(`/dragon-forest/api/lobby_status/${lobbyId}/ready/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        credentials: 'include',
        body: JSON.stringify({ ready: readyState })
    })
        .then(r => r.json())
        .then(() => {
            return fetch(lobbyStatusUrl)
                .then(r => r.json())
                .then(updateLobbyStatus)
                .catch(err => console.error("Error updating lobby after ready:", err));
        })
        .catch(err => console.error("Error setting ready:", err));
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

setInterval(fetchLobbyStatus, POLL_INTERVAL);
fetchLobbyStatus();